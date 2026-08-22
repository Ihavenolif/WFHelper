<script lang="ts">
  import { itemLabel } from "../lib/itemLabel.js";
  import { activeComponent } from "../stores/modals.js";
  import ComponentPanel from "../components/ComponentPanel.svelte";
  import DetailModalBase from "./DetailModalBase.svelte";
  import { tr } from "../lib/i18n.js";

  $: data = $activeComponent;
  $: comp = data?.comp;
  $: parentName = data?.parentName || "";

  function close() {
    activeComponent.set(null);
  }
</script>

{#if comp}
  <DetailModalBase
    ariaLabel={itemLabel(comp) || $tr("detail.componentDetails")}
    overlayClass="comp-overlay"
    onClose={close}
    wrapPanel={false}
  >
    <ComponentPanel {comp} {parentName} panelClass="comp-panel" onClose={close} />
  </DetailModalBase>
{/if}
