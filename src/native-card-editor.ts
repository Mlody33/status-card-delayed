/** Load HA's nested card editor even when editing a badge rather than a card. */
let loading: Promise<void> | undefined;

export function ensureNativeCardEditorLoaded(): Promise<void> {
  if (customElements.get("hui-card-element-editor")) return Promise.resolve();
  if (!loading) {
    loading = (async () => {
      const helpers = await window.loadCardHelpers?.();
      if (!helpers?.createCardElement) throw new Error("Home Assistant card helpers are unavailable");
      // The built-in stack editor imports and registers hui-card-element-editor.
      // Use its public factory rather than importing HA's hashed frontend files.
      const stack = await helpers.createCardElement({ type: "vertical-stack", cards: [] });
      const ctor = stack.constructor as typeof HTMLElement & {
        getConfigElement?: () => Promise<HTMLElement> | HTMLElement;
      };
      if (!ctor.getConfigElement) throw new Error("Home Assistant stack editor is unavailable");
      await ctor.getConfigElement();
      if (!customElements.get("hui-card-element-editor")) {
        throw new Error("Home Assistant did not register the card editor");
      }
    })().catch((error) => {
      loading = undefined;
      throw error;
    });
  }
  return loading;
}
