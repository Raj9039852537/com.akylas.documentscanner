<script lang="ts">
    import { closeBottomSheet } from '@nativescript-community/ui-material-bottomsheet/svelte';
    import { colors } from '~/variables';
    export let options;
    export let title = null;
    // technique for only specific properties to get updated on store change
    $: ({ colorPrimary } = $colors);

    function selectOption(option) {
        closeBottomSheet(option);
    }
</script>
``
<gesturerootview>
    <stacklayout class="bottomsheet">
        {#if title}
            <label color="#757575" fontSize="17" height="56" paddingLeft="16" text={title} verticalTextAlignment="center" />
        {/if}
        {#each options as item}
            <stacklayout height="56" orientation="horizontal" paddingBottom="5" paddingTop="5" rippleColor={colorPrimary} on:tap={() => selectOption(item)}>
                <label class="mdi" fontSize="24" paddingLeft="16" text={item.icon} verticalAlignment="middle" width="56" />
                <label fontSize="17" text={item.text} verticalAlignment="middle" />
            </stacklayout>
        {/each}
    </stacklayout>
</gesturerootview>
