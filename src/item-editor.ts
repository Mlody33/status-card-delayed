import { LitElement, TemplateResult, html, css, CSSResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { HomeAssistant, LovelaceCardConfig, Schema } from "./ha";
import { computeLabelCallback } from "./translations";
import { getTranslation } from "./translations-data";
import {
  getItemAppearanceSchema,
  getActionsSchema,
  getStyleSchema,
} from "./editor-schema";
import { renderStyleGuide } from "./style-guide";
import { resolveInlineCardConfig } from "./inline-card";
import { parseTypeKey } from "./helpers";

const ITEM_STYLE_EXAMPLE = `button:
  --mdc-icon-size: 24px;
  border: none;
  color: green;
icon:
  animation: spin 2s linear infinite;
  --mdc-icon-size: 40px;
  color: var(--primary-color);
name:
  font-size: 15px;`;

// Optional, appended to the example for domains, device classes and groups.
const COUNT_STYLE_EXAMPLE = `
count:  # optional, highest reached min wins
  - min: 3
    icon: "color: orange;"
  - min: 6
    icon: "color: red; animation: pulse 1s infinite;"`;

@customElement("status-card-delayed-item-editor")
export class ItemEditor extends LitElement {
  @property({ attribute: false }) config?: LovelaceCardConfig;
  @property({ attribute: false }) hass?: HomeAssistant;
  @property({ attribute: false }) lovelace?: unknown;
  @property({ type: Number }) index?: number;
  @property() public getSchema?: "domain" | "entity";
  @property({ type: Boolean }) public isGroup = false;
  @property({ attribute: false }) public parentConfig?: LovelaceCardConfig;
  @state() private _previewEntityId?: string;
  @state() private _config?: LovelaceCardConfig;
  @state() private _activeTab = "appearance";

  // Stable function reference for ha-form's computeLabel.
  private _computeLabel = (schema: Schema): string =>
    computeLabelCallback(this.hass!, schema);

  protected willUpdate(
    changedProps: Map<string | number | symbol, unknown>
  ): void {
    if (changedProps.has("config") && this.config) {
      if (this._config?.type !== this.config.type) this._previewEntityId = undefined;
      this._config = {
        ...this.config,
        display_mode: this.config.display_mode ??
          (this.config.badge_mode === undefined ? undefined : this.config.badge_mode ? "badge" : "standard"),
        invert_state: this.config.invert_state || "false",
      };
    }
  }

  protected render(): TemplateResult {
    if (!this.hass || !this.config) {
      return html``;
    }

    let schema;
    if (this._activeTab === "appearance") {
      schema = getItemAppearanceSchema(
        this.getSchema!,
        this.config?.type,
        this.hass,
        (this._config?.display_mode ?? (this._config?.badge_mode ? "badge" : "standard")) === "badge",
        this.isGroup
      );
    } else if (this._activeTab === "actions") {
      schema = getActionsSchema();
    } else if (this._activeTab === "style") {
      schema = getStyleSchema();
    }

    const data = {
      ...this._config,
    };

    return html`
      <ha-tab-group>
        <ha-tab-group-tab
          slot="nav"
          panel="appearance"
          .active=${this._activeTab === "appearance"}
          @click=${() => (this._activeTab = "appearance")}
        >
          ${this.hass.localize("ui.panel.lovelace.editor.card.map.appearance")}
        </ha-tab-group-tab>
        <ha-tab-group-tab
          slot="nav"
          panel="actions"
          .active=${this._activeTab === "actions"}
          @click=${() => (this._activeTab = "actions")}
        >
          ${this.hass.localize("ui.panel.lovelace.editor.card.generic.actions")}
        </ha-tab-group-tab>
        <ha-tab-group-tab
          slot="nav"
          panel="style"
          .active=${this._activeTab === "style"}
          @click=${() => (this._activeTab = "style")}
        >
          ${getTranslation("style", this.hass.locale.language)}
        </ha-tab-group-tab>
        <ha-tab-group-tab
          slot="nav"
          panel="inline"
          .active=${this._activeTab === "inline"}
          @click=${() => (this._activeTab = "inline")}
        >
          ${this._inlineText("Funkcje kart", "Entity card features")}
        </ha-tab-group-tab>
        ${this.getSchema === "domain"
          ? html`
              <ha-tab-group-tab
                slot="nav"
                panel="popup"
                .active=${this._activeTab === "popup"}
                @click=${() => (this._activeTab = "popup")}
              >
                ${getTranslation("popup_card", this.hass.locale.language)}
              </ha-tab-group-tab>
            `
          : ""}
      </ha-tab-group>
      ${this._activeTab === "style"
        ? html`
            ${renderStyleGuide(
              ["button", "icon", "name", "state"],
              this.getSchema === "domain"
                ? ITEM_STYLE_EXAMPLE + COUNT_STYLE_EXAMPLE
                : ITEM_STYLE_EXAMPLE,
            )}
          `
        : ""}
      ${this._activeTab === "popup"
        ? this._renderPopupTab()
        : this._activeTab === "inline"
          ? this._renderInlineTab()
          : html`
            <ha-form
              .hass=${this.hass}
              .data=${data}
              .schema=${schema}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._valueChangedSchema}
            ></ha-form>
          `}
    `;
  }

  private _inlineText(pl: string, en: string): string {
    return this.hass?.locale.language.startsWith("pl") ? pl : en;
  }

  private _inlinePreviewEntity(): string | undefined {
    if (!this.hass || !this._config) return undefined;
    if (this.hass.states[this._config.type]) return this._config.type;
    if (this._previewEntityId && this.hass.states[this._previewEntityId]) {
      return this._previewEntityId;
    }
    if (this.isGroup) return undefined;
    const { domain, deviceClass } = parseTypeKey(this._config.type);
    return Object.values(this.hass.states).find((entity) =>
      entity.entity_id.startsWith(`${domain}.`) &&
      (!deviceClass || entity.attributes.device_class === deviceClass),
    )?.entity_id;
  }

  private _renderInlineTab(): TemplateResult {
    const entityId = this._inlinePreviewEntity();
    const parent = this.parentConfig ?? { type: "custom:status-card-delayed" };
    const customization = [
      ...(parent.customization ?? []).filter((item: LovelaceCardConfig) =>
        item.type !== this._config!.type && !item.type.includes(".")),
      this._config!,
    ];
    const value = entityId
      ? resolveInlineCardConfig(
          { ...parent, customization }, this.hass!.states[entityId], this._config!.type,
        )
      : undefined;
    return html`
      <p>${this._inlineText(
        "Ustaw funkcje kart encji w sekcjach, np. temperaturę docelową lub tryby ogrzewania. Otwórz sekcję Funkcje w edytorze poniżej. Ustawienia pojedynczej encji mają pierwszeństwo przed grupą i domeną.",
        "Configure entity cards inside sections, such as target temperature or heating modes. Open Features in the editor below. Individual entity settings take priority over the group and domain.",
      )}</p>
      ${!this.hass!.states[this._config!.type] ? html`
        <ha-selector
          .hass=${this.hass}
          .label=${this._inlineText("Encja do podglądu funkcji", "Entity for feature preview")}
          .selector=${{ entity: {} }}
          .value=${entityId}
          @value-changed=${this._inlinePreviewChanged}
        ></ha-selector>
        <p>${this._inlineText(
          "Encja służy tylko do wyboru dostępnych funkcji. Konfiguracja obejmie całą wybraną grupę lub domenę.",
          "This entity only determines the available features. The configuration applies to the selected group or domain.",
        )}</p>
      ` : ""}
      ${this._config?.inline_card ? html`
        <ha-button @click=${this._removeInlineCard}>
          ${this._inlineText("Przywróć dziedziczone ustawienia", "Restore inherited settings")}
        </ha-button>
      ` : ""}
      ${value ? html`
        <hui-card-element-editor
          .hass=${this.hass}
          .lovelace=${this.lovelace}
          .value=${value}
          @config-changed=${this._inlineCardChanged}
        ></hui-card-element-editor>
      ` : html`<p>${this._inlineText(
        "Wybierz encję, aby skonfigurować funkcje jej karty.",
        "Select an entity to configure its card features.",
      )}</p>`}
    `;
  }

  private _inlinePreviewChanged(event: CustomEvent): void {
    event.stopPropagation();
    this._previewEntityId = event.detail.value;
  }

  private _inlineCardChanged(event: CustomEvent): void {
    event.stopPropagation();
    if (!this._config || !event.detail.config) return;
    const { entity: _entity, ...card } = event.detail.config;
    // HA omits features after removing the last one; [] disables our defaults.
    const inline_card = card.type === "tile" ? { ...card, features: card.features ?? [] } : card;
    this._emitInlineConfig({ ...this._config, inline_card });
  }

  private _removeInlineCard(): void {
    if (!this._config) return;
    const { inline_card: _inline, ...config } = this._config;
    this._emitInlineConfig(config as LovelaceCardConfig);
  }

  private _emitInlineConfig(config: LovelaceCardConfig): void {
    this._config = config;
    this.dispatchEvent(new CustomEvent("config-changed", {
      detail: { config }, bubbles: true, composed: true,
    }));
  }

  private _renderPopupTab(): TemplateResult {
    const popupCard = this._config?.popup_card;

    if (!popupCard) {
      return html`
        <div class="card-picker">
          <hui-card-picker
            .hass=${this.hass}
            .lovelace=${this.lovelace}
            @config-changed=${this._cardPicked}
          ></hui-card-picker>
        </div>
      `;
    }

    return html`
      <div class="card-editor">
        <div class="card-header">
          <h3>
            Popup
            ${this.hass!.localize(
              "ui.panel.lovelace.editor.edit_card.tab_config"
            )}
          </h3>
          <ha-button
            class="warning"
            @click=${this._removePopupCard}
            .disabled=${!popupCard}
          >
            ${this.hass!.localize("ui.common.delete")}
          </ha-button>
        </div>
        <hui-card-element-editor
          .hass=${this.hass}
          .lovelace=${this.lovelace}
          .value=${popupCard}
          @config-changed=${this._popupCardChanged}
        ></hui-card-element-editor>
      </div>
    `;
  }

  private _cardPicked(ev: CustomEvent): void {
    ev.stopPropagation();
    const config = ev.detail.config;
    this._updatePopupCard(config);
  }

  private _popupCardChanged(ev: CustomEvent): void {
    ev.stopPropagation();
    const config = ev.detail.config;
    this._updatePopupCard(config);
  }

  private _updatePopupCard(popup_card: LovelaceCardConfig): void {
    if (!this._config) return;
    const updatedConfig = {
      ...this._config,
      popup_card,
    };
    this._config = updatedConfig;
    this.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: { config: updatedConfig },
        bubbles: true,
        composed: true,
      })
    );
  }

  private _removePopupCard(): void {
    if (!this._config) return;
    const { popup_card, ...rest } = this._config;
    this._config = rest as LovelaceCardConfig;

    this.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: { config: this._config },
        bubbles: true,
        composed: true,
      })
    );
  }

  private _valueChangedSchema(event: CustomEvent): void {
    if (!this.config) {
      return;
    }
    event.stopPropagation();

    const updatedConfig: LovelaceCardConfig = {
      ...this._config,
      ...event.detail.value,
    };

    this._config = updatedConfig;

    this.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: { config: updatedConfig },
        bubbles: true,
        composed: true,
      })
    );
  }

  static get styles(): CSSResult {
    return css`
      h3 {
        margin-bottom: 0.5em;
      }
      ha-form {
        display: block;
      }
      ha-selector {
        width: 100%;
      }
      ha-tab-group {
        display: block;
        margin-bottom: 16px;
        padding: 0 1em;
      }
      ha-tab-group-tab {
        flex: 1;
      }
      ha-tab-group-tab::part(base) {
        width: 100%;
        justify-content: center;
      }
      .card-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 16px;
      }
      .card-editor {
        border: 1px solid var(--divider-color);
        padding: 12px;
        border-radius: 4px;
        margin-top: 16px;
      }
      .warning {
        --mdc-theme-primary: var(--error-color);
      }
    `;
  }
}
