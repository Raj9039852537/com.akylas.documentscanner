<svelte:options accessors />

<script lang="ts">
    import { lc } from '~/helpers/locale';
    import { colors } from '~/variables';

    export let showButton = false;
    export let title = null;
    export let text = null;
    export let progress = null;
    export let onButtonTap = null;
</script>

<template>
    <gesturerootview columns="auto,*" padding={20} rows="auto,auto,auto">
        <label colSpan={2} fontSize={20} fontWeight="bold" padding={10} text={title} textWrap={true} verticalAlignment="middle" visibility={title ? 'visible' : 'collapsed'} />
        <activityindicator class="activity-indicator" busy={true} row={1} visibility={progress === null ? 'visible' : 'collapsed'} />
        <label col={1} fontSize={16} padding={10} row={1} {text} textWrap={true} verticalAlignment="middle" />
        <progress colSpan={2} margin="10 10 0 10" maxValue={100} row={2} value={progress} visibility={progress !== null ? 'visible' : 'collapsed'} />
        <mdbutton colSpan={2} horizontalAlignment="right" row={3} text={lc('cancel')} variant="text" visibility={showButton ? 'visible' : 'collapsed'} on:tap={onButtonTap} />
    </gesturerootview>
</template>
