import { request } from '@nativescript-community/perms';
import { Canvas, ColorMatrixColorFilter, Paint } from '@nativescript-community/ui-canvas';
import { ApplicationSettings, File, Folder, ImageSource, Utils, knownFolders, path } from '@nativescript/core';
import { Observable } from '@nativescript/core/data/observable';
import SqlQuery from 'kiss-orm/dist/Queries/SqlQuery';
import CrudRepository from 'kiss-orm/dist/Repositories/CrudRepository';
import { Document, OCRDocument, OCRPage, Page, Tag } from '~/models/OCRDocument';
import { getColorMatrix } from '~/utils/ui';
import NSQLDatabase from './NSQLDatabase';
import { loadImage, recycleImages } from '~/utils/utils';
const sql = SqlQuery.createFromTemplateString;

function cleanUndefined(obj) {
    Object.keys(obj).forEach(function (key) {
        if (typeof obj[key] === 'undefined') {
            delete obj[key];
        }
    });
    return obj;
}

export class BaseRepository<T, U = T, V = any> extends CrudRepository<T, U, V> {
    constructor(data) {
        super(data);
    }
    migrations = {
        // addGroupName: sql`ALTER TABLE Groups ADD COLUMN name TEXT`,
        // addGroupOnMap: sql`ALTER TABLE Groups ADD COLUMN onMap INTEGER`
    };
    async applyMigrations() {
        const migrations = this.migrations;
        if (!migrations) {
            return;
        }
        const settingsKey = `SQLITE_${this.table}_migrations`;
        const appliedMigrations = JSON.parse(ApplicationSettings.getString(settingsKey, '[]'));

        const actualMigrations = { ...migrations };
        for (let index = 0; index < appliedMigrations.length; index++) {
            delete actualMigrations[appliedMigrations[index]];
        }

        // const migrationKeys = Object.keys(migrations).filter((k) => appliedMigrations.indexOf(k) === -1);
        // for (let index = 0; index < migrationKeys.length; index++) {
        try {
            await this.database.migrate(actualMigrations);
            appliedMigrations.push(...Object.keys(actualMigrations));
        } catch (error) {
            console.error(error, error.stack);
        }
        // }
        ApplicationSettings.setString(settingsKey, JSON.stringify(appliedMigrations));
    }
}

export class TagRepository extends BaseRepository<Tag, Tag> {
    constructor(database: NSQLDatabase) {
        super({
            database,
            table: 'Tag',
            primaryKey: 'id',
            model: Tag
        });
    }

    async createTables() {
        await this.database.query(sql`
        CREATE TABLE IF NOT EXISTS "Tag" (
            id BIGINT PRIMARY KEY NOT NULL,
            name TEXT NOT NULL
        );
        `);
        return this.applyMigrations();
    }
}
export class PageRepository extends BaseRepository<OCRPage, Page> {
    constructor(database: NSQLDatabase) {
        super({
            database,
            table: 'Page',
            primaryKey: 'id',
            model: OCRPage
        });
    }
    migrations = Object.assign(
        {
            addPageName: sql`ALTER TABLE Page ADD COLUMN name TEXT`
        },
        CARD_APP
            ? {
                  addQRCode: sql`ALTER TABLE Page ADD COLUMN qrcode TEXT`,
                  addColors: sql`ALTER TABLE Page ADD COLUMN colors TEXT`
                  // addGroupOnMap: sql`ALTER TABLE Groups ADD COLUMN onMap INTEGER`
              }
            : {}
    );
    async createTables() {
        await this.database.query(sql`
        CREATE TABLE IF NOT EXISTS "Page" (
            id TEXT PRIMARY KEY NOT NULL,
            createdDate BIGINT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
            modifiedDate NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
            pageIndex INTEGER,
            colorType TEXT,
            colorMatrix TEXT,
            transforms TEXT,
            rotation INTEGER DEFAULT 0,
            scale INTEGER DEFAULT 1,
            crop TEXT,
            ocrData TEXT,
            width INTEGER NOT NULL,
            height INTEGER NOT NULL,
            size INTEGER NOT NULL,
            sourceImagePath TEXT NOT NULL,
            imagePath TEXT NOT NULL,
            document_id TEXT,
            FOREIGN KEY(document_id) REFERENCES Document(id) ON DELETE CASCADE ON UPDATE CASCADE
        );
        `);
        return this.applyMigrations();
    }

    async createPage(page: OCRPage) {
        console.log('createPage', page);
        const createdDate = Date.now();
        return this.create({
            ...cleanUndefined(page),
            createdDate,
            pageindex: -1, // we are stuck with this as we cant migrate to remove pageIndex
            modifiedDate: createdDate,
            rotation: page.rotation && !isNaN(page.rotation) ? page.rotation : 0,
            scale: page.scale ?? 1,
            crop: page._crop || (JSON.stringify(page.crop) as any),
            colorMatrix: page._colorMatrix || (JSON.stringify(page.colorMatrix) as any),
            ocrData: page._ocrData || (JSON.stringify(page.ocrData) as any),
            ...(CARD_APP
                ? {
                      qrcode: page._qrcode || (JSON.stringify(page.qrcode) as any),
                      colors: page._colors || (JSON.stringify(page.colors) as any)
                  }
                : {})
        });
    }
    async update(page: OCRPage, data?: Partial<OCRPage>) {
        if (!data) {
            const toUpdate = {
                modifiedDate: Date.now()
            };
            await this.update(page, toUpdate);
            return page;
        }
        data.modifiedDate = Date.now();
        const toSave: Partial<Document> = {};
        const toUpdate: any = {};
        Object.keys(data).forEach((k) => {
            const value = data[k];
            toSave[k] = value;
            if (typeof value === 'object' || Array.isArray(value)) {
                toUpdate[k] = JSON.stringify(value);
            } else {
                toUpdate[k] = value;
            }
        });

        await super.update(page, toUpdate);
        Object.assign(page, toSave);
        return page;
    }
    async createModelFromAttributes(attributes: Required<any> | OCRPage): Promise<OCRPage> {
        const { id, document_id, ...other } = attributes;
        const model = new OCRPage(id, document_id);
        Object.assign(model, {
            ...other,
            _crop: other.crop,
            crop: other.crop ? JSON.parse(other.crop) : undefined,
            _colorMatrix: other.colorMatrix,
            colorMatrix: other.colorMatrix ? JSON.parse(other.colorMatrix) : undefined,
            _ocrData: other.ocrData,
            ocrData: other.ocrData ? JSON.parse(other.ocrData) : undefined,
            ...(CARD_APP
                ? {
                      _qrcode: other.qrcode,
                      qrcode: other.qrcode ? JSON.parse(other.qrcode) : undefined,
                      _colors: other.colors,
                      colors: other.colors ? JSON.parse(other.colors) : undefined
                  }
                : {})
        });
        return model;
    }
}

export class DocumentRepository extends BaseRepository<OCRDocument, Document> {
    constructor(
        database: NSQLDatabase,
        public pagesRepository: PageRepository,
        public tagsRepository: TagRepository
    ) {
        super({
            database,
            table: 'Document',
            primaryKey: 'id',
            model: OCRDocument
        });
    }

    async createTables() {
        await Promise.all([
            this.database.query(sql`
            CREATE TABLE IF NOT EXISTS "Document" (
                id TEXT PRIMARY KEY NOT NULL,
                createdDate BIGINT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
                modifiedDate BIGINT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
                name TEXT,
                _synced INTEGER DEFAULT 0
                );
        `),
            this.database.query(sql`
        CREATE TABLE IF NOT EXISTS "DocumentsTags" (
            document_id TEXT,
            tag_id TEXT,
            PRIMARY KEY(document_id, tag_id),
            FOREIGN KEY(document_id) REFERENCES Document(id) ON DELETE CASCADE,
            FOREIGN KEY(tag_id) REFERENCES Tag(id) ON DELETE CASCADE
        );
    `)
        ]);
        return this.applyMigrations();
    }

    migrations = Object.assign({
        addPagesOrder: sql`ALTER TABLE Document ADD COLUMN pagesOrder TEXT`
    });

    async createDocument(document: Document) {
        document.createdDate = document.modifiedDate = Date.now();
        document._synced = 0;
        return this.create(cleanUndefined(document));
    }

    async loadTagsRelationship(document: OCRDocument): Promise<OCRDocument> {
        const tags = await this.tagsRepository.search({
            where: sql`
            "id" IN (
                SELECT "tag_id"
                FROM "DocumentsTags"
                WHERE "document_id" = ${document.id}
            )
        `
        });
        document.tags = tags.map((g) => g.id);
        return document;
    }

    async update(document: OCRDocument, data?: Partial<OCRDocument>, updateModifiedDate = true) {
        if (!data) {
            const toUpdate: Partial<OCRDocument> = {
                _synced: 0
            };
            if (updateModifiedDate) {
                toUpdate.modifiedDate = Date.now();
            }
            await this.update(document, toUpdate);
            return document;
        }
        if (updateModifiedDate && !data.modifiedDate) {
            data.modifiedDate = Date.now();
        }
        if (data._synced === undefined) {
            data._synced = 0;
        }
        const toSave: Partial<Document> = {};
        const toUpdate: any = {};
        Object.keys(data).forEach((k) => {
            const value = data[k];
            toSave[k] = value;
            if (typeof value === 'object' || Array.isArray(value)) {
                toUpdate[k] = JSON.stringify(value);
            } else {
                toUpdate[k] = value;
            }
        });

        await super.update(document, toUpdate);
        Object.assign(document, toSave);
        return document;
    }
    async addTag(document: OCRDocument, tagId: string) {
        try {
            let tag;
            try {
                tag = await this.tagsRepository.get(tagId);
            } catch (error) {}
            // console.log('addGroupToItem', group);
            if (!tag) {
                tag = await this.tagsRepository.create({ id: tagId, name: tagId });
            }
            const relation = await this.database.query(sql` SELECT * FROM DocumentsTags WHERE "document_id" = ${document.id} AND "tag_id" = ${tagId}`);
            if (relation.length === 0) {
                await this.database.query(sql` INSERT INTO DocumentsTags ( document_id, tag_id ) VALUES(${document.id}, ${tagId})`);
            }
            document.tags = document.tags || [];
            document.tags.push(tagId);
        } catch (error) {
            console.error(error);
        }
    }

    async getItem(itemId: string) {
        const element = await this.get(itemId);
        return element;
    }
    async search(args: { postfix?: SqlQuery; select?: SqlQuery; where?: SqlQuery; orderBy?: SqlQuery }) {
        const result = await super.search({ ...args /* , postfix: sql`d LEFT JOIN PAGE p on p.document_id = d.id` */ });
        // for (let index = 0; index < result.length; index++) {
        //     const doc = result[index];
        //     doc.pages = (await this.getPages(doc)) as any;
        // }
        return result;
    }
    async createModelFromAttributes(attributes: Required<any> | OCRDocument): Promise<OCRDocument> {
        const document = new OCRDocument(attributes.id);
        Object.assign(document, {
            ...attributes,
            _pagesOrder: attributes.pagesOrder,
            pagesOrder: attributes.pagesOrder ? JSON.parse(attributes.pagesOrder) : undefined
        });

        let pages = await this.pagesRepository.search({ where: sql`document_id = ${document.id}` });
        const pagesOrder = document.pagesOrder;
        if (pagesOrder) {
            pages = pages.sort(function (a, b) {
                return pagesOrder.indexOf(a.id) - pagesOrder.indexOf(b.id);
            });
            document.pages = pages;
        } else {
            // pagesOrder was not existing before let s create it.
            pages = pages.sort(function (a, b) {
                return a['pageIndex'] - b['pageIndex'];
            });
            document.pages = pages;
            document.save();
        }
        return document;
    }
}

export class DocumentsService extends Observable {
    dataFolder: Folder;
    // connection: Connection;
    started = false;
    db: NSQLDatabase;
    pageRepository: PageRepository;
    tagRepository: TagRepository;
    documentRepository: DocumentRepository;
    async start() {
        if (this.started) {
            return;
        }
        await request('storage');
        this.dataFolder = knownFolders.externalDocuments().getFolder('data');
        const filePath = path.join(knownFolders.externalDocuments().path, 'db.sqlite');
        DEV_LOG && console.log('DocumentsService', 'start', filePath);

        this.db = new NSQLDatabase(filePath, {
            // for now it breaks
            // threading: true,
            transformBlobs: false
        } as any);
        this.pageRepository = new PageRepository(this.db);
        this.tagRepository = new TagRepository(this.db);
        this.documentRepository = new DocumentRepository(this.db, this.pageRepository, this.tagRepository);
        await this.documentRepository.createTables();
        await this.pageRepository.createTables();
        await this.tagRepository.createTables();

        this.notify({ eventName: 'started' });
        this.started = true;
    }
    async deleteDocuments(docs: OCRDocument[]) {
        // await this.documentRepository.delete(model);
        await Promise.all(docs.map((d) => this.documentRepository.delete(d)));
        // await OCRDocument.delete(docs.map((d) => d.id));
        docs.forEach((doc) => doc.removeFromDisk());
        this.notify({ eventName: 'documentsDeleted', docs });
    }
    stop() {
        DEV_LOG && console.log('DocumentsService stop');
        if (!this.started) {
            return;
        }
        this.started = false;
        this.db && this.db.disconnect();
    }

    async saveDocument(doc: OCRDocument) {
        this.documentRepository.update(doc);
        // doc.save();
    }

    async exportPDF(documents: OCRDocument[], folder = knownFolders.temp().path, filename = Date.now() + '') {
        const start = Date.now();
        const pages = documents.reduce((acc, doc) => {
            acc.push(...doc.pages);
            return acc;
        }, []);
        if (__ANDROID__) {
            // const pdfDocument = new android.graphics.pdf.PdfDocument();
            const pdfDocument = new com.tom_roush.pdfbox.pdmodel.PDDocument();
            let page: OCRPage;
            let imagePath: string;
            for (let index = 0; index < pages.length; index++) {
                page = pages[index];
                imagePath = page.getImagePath();
                let width = page.width;
                let height = page.height;
                if (page.rotation % 180 !== 0) {
                    width = page.height;
                    height = page.width;
                }
                width *= page.scale;
                height *= page.scale;
                // const pageInfo = new android.graphics.pdf.PdfDocument.PageInfo.Builder(width * page.scale, height * page.scale, index + 1).create();
                const pdfpage = new com.tom_roush.pdfbox.pdmodel.PDPage(new com.tom_roush.pdfbox.pdmodel.common.PDRectangle(0, 0, width * page.scale, height * page.scale));
                const contentStream = new com.tom_roush.pdfbox.pdmodel.PDPageContentStream(pdfDocument, pdfpage);
                // const pdfpage = pdfDocument.startPage(pageInfo);
                const pageCanvas = new Canvas(width * page.scale, height * page.scale);
                const imageSource = await loadImage(imagePath);
                let bitmapPaint: Paint = null;
                if (page.colorType || page.colorMatrix) {
                    if (!bitmapPaint) {
                        bitmapPaint = new Paint();
                    }
                    bitmapPaint.setColorFilter(new ColorMatrixColorFilter(page.colorMatrix || getColorMatrix(page.colorType)));
                }
                pageCanvas.translate(width / 2, height / 2);
                pageCanvas.rotate(page.rotation, 0, 0);
                pageCanvas.scale(page.scale, page.scale, 0, 0);
                pageCanvas.drawBitmap(imageSource.android, -page.width / 2, -page.height / 2, bitmapPaint?.['getNative']());
                const actualBitmap = pageCanvas.getImage();

                const ximage = com.tom_roush.pdfbox.pdmodel.graphics.image.JPEGFactory.createFromImage(pdfDocument, actualBitmap, 0.75, 72);
                // You may want to call PDPage.getCropBox() in order to place your image
                // somewhere inside this page rect with (x, y) and (width, height).
                contentStream.drawImage(ximage, 0, 0);
                contentStream.close();
                pdfDocument.addPage(pdfpage);
                recycleImages(imageSource, actualBitmap);
            }

            const pdfFile = knownFolders.temp().getFile(filename);
            const newFile = new java.io.File(pdfFile.path);
            pdfDocument.save(newFile);
            DEV_LOG && console.log('pdfFile', folder, filename, pdfFile.size, pdfFile.path, File.exists(path.join(folder, filename)), Date.now() - start, 'ms');
            pdfDocument.close();
            if (folder !== pdfFile.parent.path) {
                const outdocument = androidx.documentfile.provider.DocumentFile.fromTreeUri(Utils.android.getApplicationContext(), android.net.Uri.parse(folder));
                const outfile = outdocument.createFile('application/pdf', filename);
                console.log('outfile', outfile.getUri().toString());
                await new Promise((resolve, reject) => {
                    org.nativescript.widgets.Async.File.copy(
                        pdfFile.path,
                        outfile.getUri().toString(),
                        new org.nativescript.widgets.Async.CompleteCallback({
                            onComplete: resolve,
                            onError: (err) => reject(new Error(err))
                        }),
                        Utils.android.getApplicationContext()
                    );
                });
                return outfile.getUri().toString();
            }

            return pdfFile.path;
            // const stream = Utils.android.getApplicationContext().getContentResolver().openOutputStream(android.net.Uri.parse(outputPath));
            // stream.write
            // const fos = new java.io.FileOutputStream(newFile);
            // pdfDocument.writeTo(fos);
        } else {
            const pdfData = NSMutableData.alloc().init();
            UIGraphicsBeginPDFContextToData(pdfData, CGRectZero, null);
            let page: OCRPage;
            let imagePath: string;
            for (let index = 0; index < pages.length; index++) {
                page = pages[index];
                imagePath = page.getImagePath();
                let width = page.width;
                let height = page.height;
                if (page.rotation % 180 !== 0) {
                    width = page.height;
                    height = page.width;
                }
                width *= page.scale;
                height *= page.scale;
                const pageRect = CGRectMake(0, 0, width, height);
                UIGraphicsBeginPDFPageWithInfo(pageRect, null);
                const context = UIGraphicsGetCurrentContext();
                const canvas = new Canvas(0, 0);
                canvas['setContext'](context, width, height);
                const imageSource = await loadImage(imagePath);
                let toDraw = imageSource;
                if (page.colorType || page.colorMatrix || page.rotation || page.scale !== 1) {
                    let bitmapPaint: Paint = null;
                    if (page.colorType || page.colorMatrix) {
                        if (!bitmapPaint) {
                            bitmapPaint = new Paint();
                        }
                        bitmapPaint.setColorFilter(new ColorMatrixColorFilter(page.colorMatrix || getColorMatrix(page.colorType)));
                    }
                    const pageCanvas = new Canvas(width * page.scale, height * page.scale);
                    pageCanvas.translate(width / 2, height / 2);
                    pageCanvas.rotate(page.rotation, 0, 0);
                    pageCanvas.scale(page.scale, -page.scale, 0, 0);
                    pageCanvas.drawBitmap(imageSource.ios, -page.width / 2, -page.height / 2, bitmapPaint);
                    toDraw = pageCanvas.getImage();
                }
                canvas.drawBitmap(toDraw, 0, 0, null);
            }
            UIGraphicsEndPDFContext();
            if (!filename.endsWith('.pdf')) {
                filename += '.pdf';
            }
            const pdfFile = Folder.fromPath(folder).getFile(filename);
            await pdfFile.write(pdfData);
            DEV_LOG && console.log('pdfFile', folder, filename, pdfFile.size, pdfFile.path, File.exists(path.join(folder, filename)), Date.now() - start, 'ms');
            return pdfFile.path;
            // UIGraphicsBeginPDFPage();
            // const pdfContext = UIGraphicsGetCurrentContext();
        }
    }
}
export const documentsService = new DocumentsService();
