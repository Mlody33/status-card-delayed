import type { HassEntity } from "home-assistant-js-websocket";
import type { LovelaceCardConfig } from "./ha";
import { computeDomain } from "./ha";
import { customizationIndex } from "./card-styles";
import { getDomainFeatures } from "./const";
import { typeKey } from "./helpers";

/** Resolve the card used for an entity inside an inline section. */
export function resolveInlineCardConfig(
  config: LovelaceCardConfig,
  entity: HassEntity,
  contextKey: string,
  customizations = customizationIndex(config.customization),
): LovelaceCardConfig {
  const domain = computeDomain(entity.entity_id);
  const domainConfig = customizations.get(
    typeKey(domain, entity.attributes.device_class).toLowerCase(),
  );
  const sectionConfig = customizations.get(contextKey.toLowerCase());
  const entityConfig = customizations.get(entity.entity_id.toLowerCase());
  const inlineCard = entityConfig?.inline_card ??
    sectionConfig?.inline_card ?? domainConfig?.inline_card;

  // Preserve existing popup_card behavior until an inline override is set.
  if (!inlineCard && sectionConfig?.popup_card) {
    return { ...sectionConfig.popup_card, entity: entity.entity_id };
  }
  const card = inlineCard ?? domainConfig?.popup_card;
  const type = card?.type || "tile";
  return {
    ...(type === "tile"
      ? {
          ...getDomainFeatures(domain, entity),
          features_position: config.inline_feature ? "inline" : "bottom",
        }
      : {}),
    ...card,
    type,
    entity: entity.entity_id,
  };
}
