import { LitElement, html, PropertyValues, TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { keyed } from "lit/directives/keyed.js";
import { classMap } from "lit/directives/class-map.js";
import { styleMap } from "lit/directives/style-map.js";
import memoizeOne from "memoize-one";
import type { HassEntity } from "home-assistant-js-websocket";
import "./popup-dialog";
import { computeLabelCallback } from "./translations";
import {
  getIncludedEntityIds,
  mapIdsToStates,
  typeKey,
  cacheByProperty,
  isEntityActive,
  isEntityActiveOrRecentlyActive,
} from "./helpers";
import { ALLOWED_DOMAINS } from "./const";
import {
  HomeAssistant,
  computeDomain,
  hasAction,
  ActionHandlerEvent,
  actionHandler,
  applyThemesOnElement,
  LovelaceCardConfig,
  Schema,
  EntityRegistryEntry,
  DeviceRegistryEntry,
  AreaRegistryEntry,
  LovelaceCard,
} from "./ha";
import {
  computeExtraItems,
  computeGroupItems,
  computeDomainItems,
  computeDeviceClassItems,
  getPersonEntityIds,
  mapPersonIdsToStates,
} from "./card-items";
import {
  Ruleset,
  DomainItem,
  DeviceClassItem,
  ExtraItem,
  AnyItem,
  GroupItem,
  StatusCardLike,
  StatusCardPopupDialogParams,
  CardElementCache,
} from "./ha/types";
import { filterStaticEntities, filterDynamicEntities } from "./smart_groups";
import {
  getBackgroundColor,
  getCustomColor,
  getCustomIcon,
  getCustomName,
  getCustomizationForType,
  getStatusProperty,
  getIconStyles,
  customizationIndex,
  parseCss,
  getParsedCss,
  cardStyles,
  toCssColor,
  getCountStyles,
} from "./card-styles";
import { handleDomainAction, toggleDomain } from "./card-actions";
import { mdiFormatListGroup } from "@mdi/js";
import { resolveInlineCardConfig } from "./inline-card";
import {
  createCardElement,
  createCardElementSynchronous,
} from "./helpers";

export type CardDesign = "standard" | "badge" | "chip";

const designClass = (design: CardDesign): string =>
  design === "standard" ? "" : `${design}-mode`;

// Memo equality for (ids, states): same id list and same state object per id.
const sameIdsAndStates = (
  [newIds, newStates]: [string[], HomeAssistant["states"]],
  [oldIds, oldStates]: [string[], HomeAssistant["states"]],
): boolean =>
  newIds === oldIds && newIds.every((id) => newStates[id] === oldStates[id]);

@customElement("status-card-delayed")
export class StatusCard extends LitElement {
  @property({ type: Object }) public _config!: LovelaceCardConfig;
  @state() public selectedDomain: string | null = null;
  @state() public selectedDeviceClass: string | null = null;
  @state() public hiddenEntities: string[] = [];
  @state() private hiddenLabels: string[] = [];
  @state() private hiddenAreas: string[] = [];
  @state() private hide_person: boolean = false;
  @state() private hide_content_name: boolean = false;
  @state() public list_mode: boolean = false;
  @state() public design: CardDesign = "standard";
  @state() public no_background: boolean = false;
  @state() public badge_color: string = "";
  @state() public badge_text_color: string = "";
  @state() public selectedGroup: number | null = null;
  @state() private _recentActivityTick = 0;

  @property({ attribute: false }) public hass!: HomeAssistant;

  @state() public _shouldHideCard: boolean = false;
  @state() public __registryEntities: EntityRegistryEntry[] = [];
  @state() public __registryDevices: DeviceRegistryEntry[] = [];
  @state() public __registryAreas: AreaRegistryEntry[] = [];
  @state() public labels: { label_id: string; name: string }[] = [];
  private __registryFetchInProgress = false;
  @state() private _parsedGlobalCss: Record<string, string> = {};
  @state() private _parsedGlobalIconCss: Record<string, string> = {};
  @state() private _parsedGlobalCardCss: Record<string, string> = {};
  @state() private _parsedGlobalNameCss: Record<string, string> = {};
  @state() private _parsedGlobalStateCss: Record<string, string> = {};
  private _resetDomainTimeout?: ReturnType<typeof setTimeout>;
  private _resetGroupTimeout?: ReturnType<typeof setTimeout>;
  private _recentActivityTimeout?: ReturnType<typeof setTimeout>;
  private _inlineCardElementCache = new Map<string, CardElementCache>();
  private _tilePositions = new Map<string, DOMRect>();
  private _exitingTiles: HTMLElement[] = [];
  private _tileAnimationFrame?: number;
  private _tileAnimationPending = false;
  private _tileAnimations = new WeakMap<HTMLElement, Animation>();

  private static readonly TILE_ANIMATION_DURATION = 480;
  private static readonly TILE_FADE_DURATION = 220;
  private static readonly TILE_ANIMATION_EASING =
    "cubic-bezier(0.22, 1, 0.36, 1)";

  private _prefersReducedMotion(): boolean {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  }

  private _animationKeyForItem(item: AnyItem): string {
    switch (item.type) {
      case "extra":
        return `extra:${item.panel}`;
      case "domain":
        return `domain:${item.domain}`;
      case "deviceClass":
        return `device-class:${item.domain}:${item.deviceClass}`;
      case "group":
        return `group:${item.group_id}`;
    }
  }

  private _isGroupedItemVisible(item: AnyItem): boolean {
    if (item.type === "extra") {
      return !!this.hass.states[item.panel];
    }
    if (item.type === "group") {
      return this._getGroupEntities(item.ruleset).length > 0;
    }

    const deviceClass =
      item.type === "deviceClass" ? item.deviceClass : undefined;
    return (
      (this._shouldShowTotalEntities(item.domain, deviceClass)
        ? this._totalEntities(item.domain, deviceClass)
        : this._isOn(item.domain, deviceClass)
      ).length > 0
    );
  }

  private _currentAnimatedKeys(): string[] {
    if (!this._config || !this.hass) return [];

    const extra = this.getExtraItems();
    const group = this.getGroupItems();
    const domain = this.getDomainItems();
    const deviceClass = this.getDeviceClassItems();
    const items = this._computeSortedEntities(extra, group, domain, deviceClass);
    const people = this.getPersonItems();

    if (this._config.ungroup_entities) {
      return this._sortInlineEntitiesByActivation(
        this._getInlineEntities(people, items),
      ).map(
        ({ entity }) => `entity:${entity.entity_id}`,
      );
    }

    return [
      ...people.map((entity) => `person:${entity.entity_id}`),
      ...items
        .filter((item) => this._isGroupedItemVisible(item))
        .map((item) => this._animationKeyForItem(item)),
    ];
  }

  private _captureTileAnimations(): void {
    if (this._prefersReducedMotion()) return;

    const nextKeys = this._currentAnimatedKeys();
    const currentTiles = Array.from(
      this.renderRoot.querySelectorAll<HTMLElement>("[data-animation-key]"),
    );
    const currentKeys = currentTiles
      .map((tile) => tile.dataset.animationKey)
      .filter((key): key is string => !!key);
    const layoutChanged =
      currentKeys.length !== nextKeys.length ||
      currentKeys.some((key, index) => key !== nextKeys[index]);

    // State updates are frequent in Home Assistant. Avoid forcing layout and
    // starting a new Web Animation when the visible tile layout is unchanged.
    if (!layoutChanged) return;

    if (this._tileAnimationFrame !== undefined) {
      cancelAnimationFrame(this._tileAnimationFrame);
      this._tileAnimationFrame = undefined;
    }
    this._exitingTiles.splice(0).forEach((tile) => tile.remove());
    this._tilePositions.clear();
    this._tileAnimationPending = true;

    const nextKeySet = new Set(nextKeys);
    const hostRect = this.getBoundingClientRect();
    const animationLayer = this.renderRoot.querySelector<HTMLElement>(
      ".tile-animation-layer",
    );

    currentTiles.forEach((tile) => {
      const key = tile.dataset.animationKey;
      if (!key) return;

      const rect = tile.getBoundingClientRect();
      this._tilePositions.set(key, rect);
      if (nextKeySet.has(key) || !animationLayer) return;

      const ghost = document.createElement("div");
      ghost.className = "exiting-tile";
      Object.assign(ghost.style, {
        left: `${rect.left - hostRect.left}px`,
        top: `${rect.top - hostRect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
      });

      if (tile.classList.contains("inline-entity-card")) {
        const card = tile.firstElementChild;
        if (card) ghost.append(card);
      } else {
        ghost.append(tile.cloneNode(true));
      }

      animationLayer.append(ghost);
      this._exitingTiles.push(ghost);
    });
  }

  private _animateTile(
    tile: HTMLElement,
    keyframes: Keyframe[],
    options: KeyframeAnimationOptions,
  ): Animation {
    this._tileAnimations.get(tile)?.cancel();
    const animation = tile.animate(keyframes, options);
    this._tileAnimations.set(tile, animation);
    animation.finished.then(
      () => {
        if (this._tileAnimations.get(tile) === animation) {
          this._tileAnimations.delete(tile);
        }
      },
      () => {
        if (this._tileAnimations.get(tile) === animation) {
          this._tileAnimations.delete(tile);
        }
      },
    );
    return animation;
  }

  private _playTileAnimations(): void {
    this._tileAnimationPending = false;
    if (this._prefersReducedMotion()) {
      this._exitingTiles.splice(0).forEach((tile) => tile.remove());
      return;
    }

    const duration = StatusCard.TILE_ANIMATION_DURATION;
    const easing = StatusCard.TILE_ANIMATION_EASING;

    this.renderRoot
      .querySelectorAll<HTMLElement>("[data-animation-key]")
      .forEach((tile) => {
        const key = tile.dataset.animationKey;
        const previous = key ? this._tilePositions.get(key) : undefined;
        const current = tile.getBoundingClientRect();

        if (!previous) {
          this._animateTile(
            tile,
            [
              { opacity: 0 },
              { opacity: 1 },
            ],
            {
              duration: StatusCard.TILE_FADE_DURATION,
              easing: "ease-out",
            },
          );
          return;
        }

        const deltaX = previous.left - current.left;
        const deltaY = previous.top - current.top;
        if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) return;

        this._animateTile(
          tile,
          [
            {
              transform: `translate(${deltaX}px, ${deltaY}px) scale(0.96)`,
            },
            { transform: "translate(0, 0) scale(1)" },
          ],
          { duration, easing },
        );
      });

    this._exitingTiles.splice(0).forEach((tile) => {
      const animation = tile.animate(
        [
          { opacity: 1 },
          { opacity: 0 },
        ],
        {
          duration: StatusCard.TILE_FADE_DURATION,
          easing: "ease-out",
          fill: "forwards",
        },
      );
      animation.finished.then(
        () => tile.remove(),
        () => tile.remove(),
      );
    });
  }

  private _ensureRegistryData(): void {
    if (
      this.__registryEntities.length ||
      !this.hass ||
      typeof this.hass.callWS !== "function" ||
      this.__registryFetchInProgress
    ) {
      return;
    }

    this.__registryFetchInProgress = true;
    Promise.all([
      cacheByProperty<EntityRegistryEntry>(this.hass, "entity", "entity_id"),
      cacheByProperty<DeviceRegistryEntry>(this.hass, "device", "id"),
      cacheByProperty<AreaRegistryEntry>(this.hass, "area", "area_id"),
      // Optional: only needed to match smart group labels by name.
      cacheByProperty<{ label_id: string; name: string }>(
        this.hass,
        "label",
        "label_id",
      ).catch(() => ({})),
    ])
      .then(([entityMap, deviceMap, areaMap, labelMap]) => {
        this.__registryEntities = Object.values(entityMap);
        this.__registryDevices = Object.values(deviceMap);
        this.__registryAreas = Object.values(areaMap);
        this.labels = Object.values(labelMap);
      })
      .catch((e) => {
        console.error("Error fetching registry data", e);
      })
      .finally(() => {
        this.__registryFetchInProgress = false;
      });
  }

  getCardSize() {
    return Math.max(1, Math.ceil(this.scrollHeight / 50));
  }

  protected shouldUpdate(changedProps: PropertyValues): boolean {
    if (!this._config) return false;
    if (changedProps.has("_config")) return true;
    if (changedProps.has("selectedDomain")) return true;
    if (changedProps.has("selectedDeviceClass")) return true;
    if (changedProps.has("selectedGroup")) return true;
    if (changedProps.has("list_mode")) return true;
    if (changedProps.has("design")) return true;
    if (changedProps.has("_shouldHideCard")) return true;
    if (changedProps.has("_recentActivityTick")) return true;
    if (changedProps.has("__registryEntities")) return true;
    if (changedProps.has("__registryDevices")) return true;
    if (changedProps.has("__registryAreas")) return true;
    if (changedProps.has("labels")) return true;

    const oldHass = changedProps.get("hass") as HomeAssistant | undefined;
    if (!oldHass || !this.hass) return true;

    if (oldHass.themes !== this.hass.themes) return true;
    if (
      oldHass.entities !== this.hass.entities ||
      oldHass.devices !== this.hass.devices ||
      oldHass.areas !== this.hass.areas
    ) {
      return true;
    }
    if (oldHass.states !== this.hass.states) {
      // Custom inline cards may depend on entities outside this card's own
      // filters, so keep forwarding hass even when the parent can skip render.
      this._updateInlineCardsHass();
      if (this._hasRelevantStateChanged(oldHass, this.hass)) return true;
    }
    if (oldHass.localize !== this.hass.localize) return true;
    if (oldHass.language !== this.hass.language) return true;

    return false;
  }

  private _updateInlineCardsHass(): void {
    for (const { el } of this._inlineCardElementCache.values()) {
      try {
        (el as LovelaceCard).hass = this.hass;
      } catch (error) {
        console.debug(
          "status-card-delayed: Failed to update inline card hass",
          error,
        );
      }
    }
  }

  private _hasRelevantStateChanged(
    oldHass: HomeAssistant,
    newHass: HomeAssistant,
  ): boolean {
    const includedIds = this._computeIncludedIdsMemo(
      newHass.entities || {},
      newHass.devices || {},
      newHass.areas || {},
      this._config?.area || null,
      this._config?.floor || null,
      this._config?.label || null,
      this.hiddenAreas,
      this.hiddenLabels,
      this.hiddenEntities,
    );
    const relevantIds = new Set(includedIds);

    for (const id of this._computePersonIdsMemo(
      newHass.entities,
      this.hiddenEntities,
      this.hiddenLabels,
      this.hide_person,
    )) {
      relevantIds.add(id);
    }
    for (const id of
      (this._config.extra_entities as string[] | undefined) || []) {
      relevantIds.add(id);
    }
    const groupCandidates = this._computeGroupCandidatesMemo(
      this._config.rulesets || [],
      this.__registryEntities,
      this.__registryDevices,
      this.__registryAreas,
      this.hiddenEntities,
      this.labels,
    );
    groupCandidates.forEach((ids) => ids.forEach((id) => relevantIds.add(id)));

    for (const id of relevantIds) {
      if (oldHass.states[id] !== newHass.states[id]) return true;
    }
    return false;
  }

  private _computeIncludedIdsMemo = memoizeOne(
    (
      entities: HomeAssistant["entities"] | undefined,
      devices: HomeAssistant["devices"] | undefined,
      areas: HomeAssistant["areas"] | undefined,
      area: LovelaceCardConfig["area"] | null,
      floor: LovelaceCardConfig["floor"] | null,
      label: LovelaceCardConfig["label"] | null,
      hiddenAreas: string[],
      hiddenLabels: string[],
      hiddenEntities: string[],
    ) =>
      getIncludedEntityIds(
        entities || {},
        devices || {},
        areas || {},
        {
          area,
          floor,
          label,
          hiddenAreas,
          hiddenLabels,
          hiddenEntities,
        },
        ALLOWED_DOMAINS,
      ),
  );

  private _mapIdsToStatesMemo = memoizeOne(mapIdsToStates, sameIdsAndStates);

  private _customizationIndexMemo = memoizeOne(customizationIndex);

  /** Customizations indexed by type; rebuilt only when the config changes. */
  private get _custMap() {
    return this._customizationIndexMemo(this._config.customization);
  }

  private _computePersonIdsMemo = memoizeOne(getPersonEntityIds);

  private _mapPersonIdsToStatesMemo = memoizeOne(
    mapPersonIdsToStates,
    sameIdsAndStates,
  );

  private _computeExtraItemsMemo = memoizeOne(
    computeExtraItems,
    (newArgs, oldArgs) => {
      const [newCfg, newStates, newCustMap] = newArgs;
      const [oldCfg, oldStates, oldCustMap] = oldArgs;

      if (newCfg !== oldCfg || newCustMap !== oldCustMap) return false;

      const extraEntities = newCfg.extra_entities as string[] | undefined;
      if (!extraEntities) return true;

      for (const id of extraEntities) {
        if (newStates[id] !== oldStates[id]) return false;
      }

      return true;
    },
  );

  private _computeGroupItemsMemo = memoizeOne(computeGroupItems);
  private _computeDomainItemsMemo = memoizeOne(computeDomainItems);
  private _computeDeviceClassItemsMemo = memoizeOne(computeDeviceClassItems);

  public _computeEntityMap = memoizeOne(
    (entities: EntityRegistryEntry[]) =>
      new Map(entities.map((e) => [e.entity_id, e])),
  );
  public _computeDeviceMap = memoizeOne(
    (devices: DeviceRegistryEntry[]) => new Map(devices.map((d) => [d.id, d])),
  );
  public _computeAreaMap = memoizeOne(
    (areas: AreaRegistryEntry[]) => new Map(areas.map((a) => [a.area_id, a])),
  );

  private _computeGroupCandidatesMemo = memoizeOne(
    (
      rulesets: Ruleset[],
      entities: EntityRegistryEntry[],
      devices: DeviceRegistryEntry[],
      areas: AreaRegistryEntry[],
      hiddenEntities: string[],
      labels: StatusCardLike["labels"],
    ): Map<string, string[]> => {
      const map = new Map();
      const entityMap = this._computeEntityMap(entities);
      const deviceMap = this._computeDeviceMap(devices);
      const areaMap = this._computeAreaMap(areas);

      rulesets.forEach((rs) => {
        const candidates = filterStaticEntities(
          rs,
          entities,
          hiddenEntities,
          entityMap,
          deviceMap,
          areaMap,
          labels,
        );
        map.set(rs.group_id, candidates);
      });
      return map;
    },
  );

  private _computeGroupResultsMemo = memoizeOne(
    (
      candidatesMap: Map<string, string[]>,
      states: HomeAssistant["states"],
      rulesets: Ruleset[],
      entities: EntityRegistryEntry[],
      devices: DeviceRegistryEntry[],
      areas: AreaRegistryEntry[],
      config: LovelaceCardConfig,
      _recentActivityTick: number,
      labels: StatusCardLike["labels"],
    ): Map<string, HassEntity[]> => {
      const map = new Map();
      const fakeCard = {
        __registryEntities: entities,
        __registryDevices: devices,
        __registryAreas: areas,
        hass: { states },
        labels,
      } as StatusCardLike;

      const entityMap = this._computeEntityMap(entities);
      const deviceMap = this._computeDeviceMap(devices);
      const areaMap = this._computeAreaMap(areas);

      rulesets.forEach((rs) => {
        const candidates = candidatesMap.get(rs.group_id) || [];
        const recentlyActiveSeconds = Number(
          this.getCustomizationForType(rs.group_id)?.recently_active_seconds ??
            config.recently_active_seconds ??
            0,
        );
        const results = filterDynamicEntities(
          fakeCard,
          rs,
          candidates,
          states,
          entityMap,
          deviceMap,
          areaMap,
          (entity) =>
            this._isEntityRecentlyInactive(
              entity,
              recentlyActiveSeconds,
            ),
        );
        map.set(rs.group_id, results);
      });
      return map;
    },
  );

  /** Entities per smart group id (static candidates + live state filters). */
  private _groupResults(): Map<string, HassEntity[]> {
    const candidatesMap = this._computeGroupCandidatesMemo(
      this._config.rulesets || [],
      this.__registryEntities,
      this.__registryDevices,
      this.__registryAreas,
      this.hiddenEntities,
      this.labels,
    );

    return this._computeGroupResultsMemo(
      candidatesMap,
      this.hass.states,
      this._config.rulesets || [],
      this.__registryEntities,
      this.__registryDevices,
      this.__registryAreas,
      this._config,
      this._recentActivityTick,
      this.labels,
    );
  }

  private _entitiesByDomain(): { [domain: string]: HassEntity[] } {
    const entities = this.hass.entities || [];
    const devices = this.hass.devices || [];
    const areas = this.hass.areas || [];
    const states = this.hass?.states || {};

    const area = this._config?.area || null;
    const floor = this._config?.floor || null;
    const label = this._config?.label || null;
    const hiddenAreas = this.hiddenAreas;
    const hiddenLabels = this.hiddenLabels;
    const hiddenEntities = this.hiddenEntities;

    const includedIds = this._computeIncludedIdsMemo(
      entities,
      devices,
      areas,
      area,
      floor,
      label,
      hiddenAreas,
      hiddenLabels,
      hiddenEntities,
    );

    return this._mapIdsToStatesMemo(includedIds, states);
  }

  // Per domain entity list (new array whenever one of its states changes),
  // the filtered result per device class.
  private _baseEntitiesCache = new WeakMap<HassEntity[], Map<string, HassEntity[]>>();

  private _baseEntities(domain: string, deviceClass?: string): HassEntity[] {
    const all = this._entitiesByDomain()[domain] || [];
    let byClass = this._baseEntitiesCache.get(all);
    if (!byClass) {
      byClass = new Map();
      this._baseEntitiesCache.set(all, byClass);
    }
    const key = deviceClass ?? "";
    let result = byClass.get(key);
    if (!result) {
      result = all.filter((entity) => {
        const st = entity.state;
        if (st === "unavailable" || st === "unknown") return false;
        const dc = entity.attributes.device_class;
        if (domain === "switch") {
          if (deviceClass === "outlet") return dc === "outlet";
          if (deviceClass === "switch")
            return dc === "switch" || dc === undefined;
          return true;
        }
        return !deviceClass || dc === deviceClass;
      });
      byClass.set(key, result);
    }
    return result;
  }

  public _totalEntities(domain: string, deviceClass?: string): HassEntity[] {
    return this._baseEntities(domain, deviceClass);
  }

  public _shouldShowTotalEntities(
    domain: string,
    deviceClass?: string,
  ): boolean {
    if (this._config.show_total_entities) return true;

    const key = typeKey(domain, deviceClass);
    const customization = this.getCustomizationForType(key);
    return customization?.show_total_entities === true;
  }
  public _shouldShowTotalNumbers(
    domain: string,
    deviceClass?: string,
  ): boolean {
    if (this._config.show_total_number) return true;

    const key = typeKey(domain, deviceClass);
    const customization = this.getCustomizationForType(key);
    return customization?.show_total_number === true;
  }

  public _isOn(domain: string, deviceClass?: string): HassEntity[] {
    const ents = this._baseEntities(domain, deviceClass);

    return ents.filter((entity) =>
      this.isEntityVisibleAsActive(entity, domain, deviceClass),
    );
  }

  private _currentlyActiveEntities(
    domain: string,
    deviceClass?: string,
  ): HassEntity[] {
    const customization = this.getCustomizationForType(
      typeKey(domain, deviceClass),
    );

    return this._baseEntities(domain, deviceClass).filter((entity) =>
      isEntityActive(
        entity,
        domain,
        deviceClass,
        customization?.invert === true,
      ),
    );
  }

  private _isEntityRecentlyInactive(
    entity: HassEntity,
    recentlyActiveSeconds: number,
    now = Date.now(),
  ): boolean {
    if (
      !Number.isFinite(recentlyActiveSeconds) ||
      recentlyActiveSeconds <= 0 ||
      entity.state === "unavailable" ||
      entity.state === "unknown"
    ) {
      return false;
    }

    const domain = computeDomain(entity.entity_id);
    const deviceClass = entity.attributes.device_class;
    const customization = this.getCustomizationForType(
      typeKey(domain, deviceClass),
    );
    if (
      isEntityActive(
        entity,
        domain,
        deviceClass,
        customization?.invert === true,
      )
    ) {
      return false;
    }

    const lastChanged = Date.parse(entity.last_changed);
    return (
      Number.isFinite(lastChanged) &&
      now - lastChanged < recentlyActiveSeconds * 1000
    );
  }

  public isEntityVisibleAsActive(
    entity: HassEntity,
    domain?: string,
    deviceClass?: string,
  ): boolean {
    const effectiveDomain = domain || computeDomain(entity.entity_id);
    const effectiveDeviceClass =
      deviceClass ?? entity.attributes.device_class;
    const key = typeKey(effectiveDomain, effectiveDeviceClass);
    const customization = this.getCustomizationForType(key);
    const isInverted = customization?.invert === true;
    const recentlyActiveSeconds =
      customization?.recently_active_seconds ??
      this._config.recently_active_seconds ??
      0;

    return isEntityActiveOrRecentlyActive(
      entity,
      effectiveDomain,
      effectiveDeviceClass,
      isInverted,
      recentlyActiveSeconds,
    );
  }

  public setConfig(config: LovelaceCardConfig): void {
    if (!config) {
      throw new Error("Invalid configuration.");
    }
    this._config = config;
    this.hide_person =
      config.hide_person !== undefined ? config.hide_person : false;
    this.hide_content_name =
      config.hide_content_name !== undefined ? config.hide_content_name : false;
    this.list_mode = config.list_mode !== undefined ? config.list_mode : false;
    this.design =
      config.display_mode || (config.badge_mode ? "badge" : "standard");
    this.no_background = !!config.no_background;
    this.badge_color = config.badge_color || "";
    this.badge_text_color = config.badge_text_color || "";
    this.hiddenEntities = config.hidden_entities || [];
    this.hiddenLabels = config.hidden_labels || [];
    this.hiddenAreas = config.hidden_areas || [];

    const styles = this._config.styles ?? {};

    this._parsedGlobalCardCss = parseCss(styles.card);
    this._parsedGlobalCss = parseCss(styles.button);
    this._parsedGlobalIconCss = parseCss(styles.icon);
    this._parsedGlobalNameCss = parseCss(styles.name);
    this._parsedGlobalStateCss = parseCss(styles.state);
  }

  private _showPopup(
    element: HTMLElement,
    dialogTag: string,
    dialogParams: StatusCardPopupDialogParams,
  ): void {
    element.dispatchEvent(
      new CustomEvent("show-dialog", {
        detail: {
          dialogTag,
          dialogImport: () => customElements.whenDefined(dialogTag),
          dialogParams,
          opener: element,
        },
        bubbles: true,
        composed: true,
      }),
    );
  }

  public computeLabel = (
    schema: Schema,
    domain?: string,
    deviceClass?: string,
  ): string => {
    if (!this.hass || !schema) return schema?.name || "";
    return computeLabelCallback(this.hass, schema, domain, deviceClass);
  };

  private _openDomainPopup(domain: string | number) {
    let title = "Details";
    if (typeof domain === "string") {
      title =
        getCustomName(this._config, domain, undefined, undefined, this._custMap) ||
        this.computeLabel({ name: domain });
    } else if (typeof domain === "number" && this._config.content?.[domain]) {
      title = this._config.content[domain];
    }

    let entities: HassEntity[] = [];
    let allEntities: HassEntity[] = [];

    if (typeof domain === "number") {
      const groupId = this._config.content?.[domain];
      const ruleset = this._config.rulesets?.find(
        (g) => g.group_id === groupId,
      );
      if (ruleset) {
        allEntities = this._getGroupEntities(ruleset);
        entities = allEntities;
      } else {
        entities = [];
        allEntities = [];
      }
    } else {
      const deviceClass = this.selectedDeviceClass || undefined;
      allEntities = this._totalEntities(domain, deviceClass);
      entities = this._shouldShowTotalEntities(domain, deviceClass)
        ? allEntities
        : this._isOn(domain, deviceClass);
    }

    const showAll =
      typeof domain === "string"
        ? this._shouldShowTotalEntities(
            domain,
            this.selectedDeviceClass || undefined,
          )
        : false;

    const dialogTag = "status-card-delayed-popup";
    this._showPopup(this, dialogTag, {
      title,
      hass: this.hass,
      entities,
      allEntities,
      selectedDomain: typeof domain === "string" ? domain : undefined,
      selectedDeviceClass: this.selectedDeviceClass || undefined,
      selectedGroup:
        this.selectedGroup !== null ? this.selectedGroup : undefined,
      card: this,
      opener: this,
      content: entities.length
        ? undefined
        : (this.hass?.localize("ui.card.empty_state.no_entities") ??
          "No entities"),
      initialShowAll: showAll,
    });
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    clearTimeout(this._resetDomainTimeout);
    clearTimeout(this._resetGroupTimeout);
    clearTimeout(this._recentActivityTimeout);
    if (this._tileAnimationFrame !== undefined) {
      cancelAnimationFrame(this._tileAnimationFrame);
    }
    this._exitingTiles.splice(0).forEach((tile) => tile.remove());
    this._tilePositions.clear();
    this._tileAnimationPending = false;
    this._inlineCardElementCache.clear();
  }

  protected willUpdate(changedProps: PropertyValues): void {
    super.willUpdate(changedProps);

    if (!this._config || !this.hass) return;

    this._captureTileAnimations();

    // Registry data feeds smart groups, so it can flip "hide if empty" too.
    if (
      changedProps.has("hass") ||
      changedProps.has("_config") ||
      changedProps.has("__registryEntities") ||
      changedProps.has("__registryDevices") ||
      changedProps.has("__registryAreas") ||
      changedProps.has("_recentActivityTick") ||
      changedProps.has("labels")
    ) {
      this._updateShouldHideCard();
    }
  }

  protected updated(changedProps: PropertyValues): void {
    super.updated(changedProps);

    if (!this._config || !this.hass) return;

    if (this._tileAnimationPending && this._tileAnimationFrame === undefined) {
      // Slotted HA tabs recalculate their layout after Lit's update. Waiting for
      // the next paint gives FLIP the final positions instead of the old ones.
      this._tileAnimationFrame = requestAnimationFrame(() => {
        this._tileAnimationFrame = undefined;
        this._playTileAnimations();
      });
    }

    this._ensureRegistryData();
    if (
      changedProps.has("hass") ||
      changedProps.has("_config") ||
      changedProps.has("__registryEntities") ||
      changedProps.has("__registryDevices") ||
      changedProps.has("__registryAreas") ||
      changedProps.has("_recentActivityTick")
    ) {
      this._scheduleRecentActivityUpdate();
    }

    const oldHass = changedProps.get("hass") as HomeAssistant | undefined;
    const oldConfig = changedProps.get("_config") as
      | LovelaceCardConfig
      | undefined;

    if (changedProps.has("selectedDomain") && this.selectedDomain) {
      const domain = this.selectedDomain;
      if (domain.includes(".")) {
        const entityId = domain;
        const stateObj = this.hass.states[entityId];
        if (stateObj) {
          this.showMoreInfo(stateObj);
        }
      } else {
        this._openDomainPopup(domain);
      }
      clearTimeout(this._resetDomainTimeout);
      this._resetDomainTimeout = setTimeout(() => {
        this.selectedDomain = null;
      }, 0);
    }

    if (changedProps.has("selectedGroup") && this.selectedGroup !== null) {
      const group = this.selectedGroup;
      this._openDomainPopup(group);
      clearTimeout(this._resetGroupTimeout);
      this._resetGroupTimeout = setTimeout(() => {
        this.selectedGroup = null;
      }, 0);
    }

    if (
      (changedProps.has("hass") &&
        (!oldHass || oldHass.themes !== this.hass.themes)) ||
      (changedProps.has("_config") &&
        (!oldConfig || oldConfig.theme !== this._config.theme))
    ) {
      applyThemesOnElement(
        this,
        this.hass.themes,
        this._config.theme,
        undefined,
        true,
      );
    }
  }

  private _handlePersonAction = (
    entity: HassEntity,
  ): ((ev: ActionHandlerEvent) => void) => {
    return (ev: ActionHandlerEvent) => {
      ev.stopPropagation();
      this.showMoreInfo(entity);
    };
  };

  private showMoreInfo(entity: HassEntity): void {
    const event = new CustomEvent("hass-more-info", {
      detail: { entityId: entity.entity_id },
      bubbles: true,
      composed: true,
    });
    this.dispatchEvent(event);
  }

  private _hasContent(): boolean {
    if (this.getPersonItems().length > 0) {
      return true;
    }

    const extra = this.getExtraItems();
    if (extra.length > 0) {
      const hasVisibleExtra = extra.some((item) => {
        const stateObj = this.hass?.states[item.panel];
        return (
          stateObj &&
          stateObj.state !== "unavailable" &&
          stateObj.state !== "unknown"
        );
      });
      if (hasVisibleExtra) return true;
    }

    const allGroupEntities = this._groupResults();
    const hasGroupContent = this.getGroupItems().some((g) => {
      const entities = allGroupEntities.get(g.group_id) || [];
      return entities.length > 0;
    });
    if (hasGroupContent) {
      return true;
    }

    const domainAndDeviceClassItems = [
      ...this.getDomainItems(),
      ...this.getDeviceClassItems(),
    ];

    for (const item of domainAndDeviceClassItems) {
      const entities = this._baseEntities(
        item.domain,
        (item as DeviceClassItem).deviceClass,
      );
      if (entities.length === 0) continue;

      const key = (item as DeviceClassItem).deviceClass
        ? `${item.domain} - ${(item as DeviceClassItem).deviceClass}`
        : item.domain;
      const customization = this.getCustomizationForType(key);
      const showAll =
        this._config.show_total_entities ||
        customization?.show_total_entities === true;

      if (showAll) return true;

      const active = entities.filter((entity) =>
        this.isEntityVisibleAsActive(
          entity,
          item.domain,
          (item as DeviceClassItem).deviceClass,
        ),
      );
      if (active.length > 0) return true;
    }

    return false;
  }

  private _scheduleRecentActivityUpdate(): void {
    clearTimeout(this._recentActivityTimeout);

    const now = Date.now();
    let nextExpiration = Number.POSITIVE_INFINITY;

    for (const entity of Object.values(this.hass.states)) {
      const domain = computeDomain(entity.entity_id);
      const deviceClass = entity.attributes.device_class;
      const customization = this.getCustomizationForType(
        typeKey(domain, deviceClass),
      );
      const seconds = Number(
        customization?.recently_active_seconds ??
          this._config.recently_active_seconds ??
          0,
      );
      if (!Number.isFinite(seconds) || seconds <= 0) continue;

      const isInverted = customization?.invert === true;
      if (isEntityActive(entity, domain, deviceClass, isInverted)) continue;

      const lastChanged = Date.parse(entity.last_changed);
      if (!Number.isFinite(lastChanged)) continue;

      const expiration = lastChanged + seconds * 1000;
      if (expiration > now && expiration < nextExpiration) {
        nextExpiration = expiration;
      }
    }

    // Smart groups may have their own delay. Their cached results must be
    // refreshed when the last recently inactive entity leaves the grace period.
    const groupDurations = new Set<number>();
    for (const ruleset of this._config.rulesets || []) {
      const seconds = Number(
        this.getCustomizationForType(ruleset.group_id)
          ?.recently_active_seconds ??
          this._config.recently_active_seconds ??
          0,
      );
      if (Number.isFinite(seconds) && seconds > 0) {
        groupDurations.add(seconds);
      }
    }

    for (const seconds of groupDurations) {
      for (const entity of Object.values(this.hass.states)) {
        if (!this._isEntityRecentlyInactive(entity, seconds, now)) continue;

        const expiration =
          Date.parse(entity.last_changed) + seconds * 1000;
        if (expiration > now && expiration < nextExpiration) {
          nextExpiration = expiration;
        }
      }
    }

    if (Number.isFinite(nextExpiration)) {
      this._recentActivityTimeout = setTimeout(() => {
        this._recentActivityTick++;
        this._updateShouldHideCard();
      }, Math.max(0, nextExpiration - now) + 50);
    }
  }

  private _updateShouldHideCard(): void {
    if ((this._config.hide_card_if_empty ?? false) !== true) {
      this._shouldHideCard = false;
      this.hidden = false;
      return;
    }

    this._shouldHideCard = !this._hasContent();
    this.hidden = this._shouldHideCard;
  }

  private getPersonItems(): HassEntity[] {
    const ids = this._computePersonIdsMemo(
      this.hass.entities,
      this.hiddenEntities,
      this.hiddenLabels,
      this.hide_person,
    );
    return this._mapPersonIdsToStatesMemo(ids, this.hass.states);
  }

  public getExtraItems(): ExtraItem[] {
    if (!this._config || !this.hass) {
      return [];
    }
    return this._computeExtraItemsMemo(
      this._config,
      this.hass.states,
      this._custMap,
    );
  }

  private getGroupItems(): GroupItem[] {
    return this._computeGroupItemsMemo(
      this._config.content || [],
      this._config.rulesets || [],
    );
  }

  private getDomainItems(): DomainItem[] {
    return this._computeDomainItemsMemo(this._config.content || []);
  }

  private getDeviceClassItems(): DeviceClassItem[] {
    return this._computeDeviceClassItemsMemo(this._config.content || []);
  }
  public toggleDomain(domain?: string, deviceClass?: string): void {
    domain = domain ?? this.selectedDomain!;
    deviceClass = deviceClass ?? this.selectedDeviceClass!;
    const entities = this._isOn(domain, deviceClass);
    toggleDomain(this.hass, entities, domain);
  }

  // One stable handler per item, so lit does not rebind listeners on every render.
  // Handlers read hass/_config at call time, so they never go stale.
  private _domainActionHandlers = new Map<string, (ev: ActionHandlerEvent) => void>();

  private _handleDomainAction(
    domain: string,
    deviceClass?: string,
  ): (ev: ActionHandlerEvent) => void {
    const key = typeKey(domain, deviceClass);
    let handler = this._domainActionHandlers.get(key);
    if (!handler) {
      handler = (ev: ActionHandlerEvent) => {
        handleDomainAction(
          this,
          this.hass,
          this._config,
          domain,
          deviceClass,
          ev,
          {
            showMoreInfo: (entityId) => {
              const stateObj = this.hass.states[entityId];
              if (stateObj) this.showMoreInfo(stateObj);
            },
            toggleDomain: (d, dc) => this.toggleDomain(d, dc),
            selectDomain: (d, dc) => {
              this.selectedDomain = d;
              this.selectedDeviceClass = dc || null;
            },
          },
        );
      };
      this._domainActionHandlers.set(key, handler);
    }
    return handler;
  }

  private _handleGroupAction(
    groupId: string,
    index: number,
    entities: HassEntity[],
  ): (ev: ActionHandlerEvent) => void {
    return (ev: ActionHandlerEvent) => {
      handleDomainAction(
        this,
        this.hass,
        this._config,
        groupId,
        undefined,
        ev,
        {
          showMoreInfo: (entityId) => {
            const stateObj = this.hass.states[entityId];
            if (stateObj) this.showMoreInfo(stateObj);
          },
          toggleDomain: () => {
            // One service call per domain instead of one per entity.
            const byDomain = new Map<string, HassEntity[]>();
            for (const e of entities) {
              const d = computeDomain(e.entity_id);
              byDomain.set(d, [...(byDomain.get(d) ?? []), e]);
            }
            byDomain.forEach((ents, d) => toggleDomain(this.hass, ents, d));
          },
          selectDomain: () => {
            this.selectedGroup = index;
          },
        },
      );
    };
  }

  public getCustomizationForType(type: string): LovelaceCardConfig | undefined {
    return getCustomizationForType(
      this._config,
      type,
      this._custMap,
    );
  }

  private _getIconStyles(
    type: "person" | "extra" | "domain" | "deviceClass",
    options: {
      color?: string;
      background_color?: string;
      square?: boolean;
      isNotHome?: boolean;
    } = {},
  ) {
    return getIconStyles(type, options);
  }

  private _computeActionHandler = memoizeOne(
    (hasHold: boolean, hasDoubleClick: boolean) => {
      return actionHandler({ hasHold, hasDoubleClick });
    },
  );

  private _computeBadgeStyles(customization?: LovelaceCardConfig) {
    const badgeColor =
      customization?.badge_color || this.badge_color || undefined;
    const badgeTextColor =
      customization?.badge_text_color || this.badge_text_color || undefined;
    const badgeStyles = {
      "--status-card-delayed-badge-color": toCssColor(badgeColor),
      "--status-card-delayed-badge-text-color": toCssColor(badgeTextColor),
    };
    return { badgeColor, badgeTextColor, badgeStyles };
  }

  private _computeButtonStyles(customization?: LovelaceCardConfig) {
    const itemStyles = getParsedCss(
      customization?.styles?.button || customization?.styles?.card,
      customization as { _parsedCss?: Record<string, string> },
    );
    return { ...this._parsedGlobalCss, ...itemStyles };
  }

  private _computeCustomIconStyles(customization?: LovelaceCardConfig) {
    const itemIconStyles =
      customization?._parsedIconCss || parseCss(customization?.styles?.icon);
    return { ...this._parsedGlobalIconCss, ...itemIconStyles };
  }

  private _computeTabStyles(
    customization?: LovelaceCardConfig,
    iconType: "domain" | "extra" = "domain",
    iconOpts?: { color?: string; background_color?: string },
  ) {
    const ah = this._computeActionHandler(
      hasAction(customization?.hold_action ?? this._config.hold_action),
      hasAction(
        customization?.double_tap_action ?? this._config.double_tap_action,
      ),
    );
    const contentClasses = {
      horizontal: this._config.content_layout === "horizontal",
    };
    const iconStyles = this._getIconStyles(iconType, {
      ...iconOpts,
      square: this._config.square,
    });
    const { badgeStyles } = this._computeBadgeStyles(customization);
    const buttonStyles = this._computeButtonStyles(customization);
    const customIconStyles = this._computeCustomIconStyles(customization);
    const design: CardDesign =
      customization?.display_mode ||
      (customization?.badge_mode === undefined
        ? this.design
        : customization.badge_mode ? "badge" : "standard");
    const showBadge = design === "badge";
    return {
      ah,
      contentClasses,
      iconStyles,
      badgeStyles,
      buttonStyles,
      customIconStyles,
      showBadge,
      design,
    };
  }

  private _renderIcon(icon: string): TemplateResult {
    return icon.startsWith("M")
      ? html`<ha-svg-icon .path=${icon}></ha-svg-icon>`
      : html`<ha-icon icon=${icon}></ha-icon>`;
  }

  /** Markup shared by extra entity, smart group and domain tabs. */
  private _renderTabShell(opts: {
    panel: string;
    handler: (ev: ActionHandlerEvent) => void;
    customization?: LovelaceCardConfig;
    iconType: "domain" | "extra";
    color?: string;
    background_color?: string;
    count: number;
    badgeCount?: number;
    animationKey: string;
    entityClass: "entity" | "extra-entity";
    icon: TemplateResult;
    name: unknown;
    state: unknown;
  }): TemplateResult {
    const {
      ah,
      contentClasses,
      iconStyles,
      badgeStyles,
      buttonStyles,
      customIconStyles,
      showBadge,
      design,
    } = this._computeTabStyles(opts.customization, opts.iconType, {
      color: opts.color,
      background_color: opts.background_color,
    });
    const badgeCount = opts.badgeCount ?? opts.count;
    const countStyles = getCountStyles(
      opts.customization?._countLevels,
      opts.count,
    );

    return html`
      <ha-tab-group-tab
        slot="nav"
        panel=${opts.panel}
        data-animation-key=${opts.animationKey}
        @action=${opts.handler}
        .actionHandler=${ah}
        class=${designClass(design)}
        style=${styleMap(badgeStyles)}
      >
        ${showBadge && badgeCount > 0
          ? keyed(
              badgeCount,
              html`<span class="count-badge">${badgeCount}</span>`,
            )
          : ""}
        <div
          class=${classMap({ [opts.entityClass]: true, ...contentClasses })}
          style=${styleMap({ ...buttonStyles, ...countStyles.button })}
        >
          <div
            class="entity-icon"
            style=${styleMap({
              ...iconStyles,
              ...customIconStyles,
              ...countStyles.icon,
            })}
          >
            ${opts.icon}
          </div>
          ${!showBadge
            ? html`<div class="entity-info">
                ${!this.hide_content_name
                  ? html`<div
                      class="entity-name"
                      style=${styleMap({
                        ...this._parsedGlobalNameCss,
                        ...opts.customization?._parsedNameCss,
                        ...countStyles.name,
                      })}
                    >
                      ${opts.name}
                    </div>`
                  : ""}
                <div
                  class="entity-state"
                  style=${styleMap({
                    ...this._parsedGlobalStateCss,
                    ...opts.customization?._parsedStateCss,
                    ...countStyles.state,
                  })}
                >
                  ${opts.state}
                </div>
              </div>`
            : ""}
        </div>
      </ha-tab-group-tab>
    `;
  }

  private renderExtraTab(item: ExtraItem): TemplateResult {
    const { panel, icon, name, color, icon_css, background_color } = item;
    const stateObj = this.hass.states[panel];
    const customization = this.getCustomizationForType(panel);
    const stateContent = customization?.state_content ?? "state";

    const iconTpl =
      icon.startsWith("/") || icon.startsWith("http")
        ? html`<img
            src=${icon}
            alt=${name}
            style="border-radius:${this._config.square
              ? "20%"
              : "50%"};object-fit:cover;"
          />`
        : icon.startsWith("M")
          ? html`<ha-svg-icon
              .path=${icon}
              style="${icon_css || ""}"
            ></ha-svg-icon>`
          : html`<ha-state-icon
              .hass=${this.hass}
              .stateObj=${stateObj}
              .icon=${icon}
              data-domain=${computeDomain(panel)}
              data-state=${stateObj.state}
              style="${icon_css || ""}"
            ></ha-state-icon>`;

    return this._renderTabShell({
      panel,
      animationKey: this._animationKeyForItem(item),
      handler: this._handleDomainAction(panel),
      customization,
      iconType: "extra",
      color,
      background_color,
      count: 1,
      entityClass: "extra-entity",
      icon: iconTpl,
      name,
      state: html`<state-display
        .stateObj=${stateObj}
        .hass=${this.hass}
        .content=${stateContent}
        .name=${name}
      ></state-display>`,
    });
  }

  private renderGroupTab(ruleset: Ruleset, index: number): TemplateResult {
    const entities = this._groupResults().get(ruleset.group_id) || [];

    if (!entities.length) return html``;

    const groupId =
      ruleset.group_id ||
      `${this.hass!.localize("component.group.entity_component._.name")} ${
        index + 1
      }`;
    const groupIcon = ruleset.group_icon || mdiFormatListGroup;
    const color = getCustomColor(
      this._config,
      groupId,
      undefined,
      this._custMap,
    );
    const background_color = getBackgroundColor(
      this._config,
      groupId,
      undefined,
      this._custMap,
    );

    const customization = this.getCustomizationForType(groupId);
    const currentlyActiveEntities =
      this._getCurrentlyActiveGroupEntities(ruleset);
    const badgeOnlyActiveEntities =
      this._config.badge_only_active_entities ?? true;
    const badgeCount = badgeOnlyActiveEntities
      ? currentlyActiveEntities.length
      : entities.length;

    return this._renderTabShell({
      panel: "group-" + index,
      animationKey: `group:${ruleset.group_id}`,
      badgeCount,
      handler: this._handleGroupAction(groupId, index, entities),
      customization,
      iconType: "domain",
      color,
      background_color,
      count: entities.length,
      entityClass: "entity",
      icon: this._renderIcon(groupIcon),
      name: groupId,
      state: `${currentlyActiveEntities.length}${
        ruleset.group_status ? ` ${ruleset.group_status}` : ""
      }`,
    });
  }

  private _getGroupEntities(ruleset: Ruleset): HassEntity[] {
    return this._groupResults().get(ruleset.group_id) || [];
  }

  private _getCurrentlyActiveGroupEntities(ruleset: Ruleset): HassEntity[] {
    const candidatesMap = this._computeGroupCandidatesMemo(
      this._config.rulesets || [],
      this.__registryEntities,
      this.__registryDevices,
      this.__registryAreas,
      this.hiddenEntities,
      this.labels,
    );
    const fakeCard = {
      __registryEntities: this.__registryEntities,
      __registryDevices: this.__registryDevices,
      __registryAreas: this.__registryAreas,
      hass: { states: this.hass.states },
      labels: this.labels,
    } as StatusCardLike;

    return filterDynamicEntities(
      fakeCard,
      ruleset,
      candidatesMap.get(ruleset.group_id) || [],
      this.hass.states,
      this._computeEntityMap(this.__registryEntities),
      this._computeDeviceMap(this.__registryDevices),
      this._computeAreaMap(this.__registryAreas),
    );
  }

  private _getInlineCardConfig(
    groupId: string,
    entity: HassEntity,
  ): LovelaceCardConfig {
    return resolveInlineCardConfig(this._config, entity, groupId, this._custMap);
  }

  private _getOrCreateInlineCard(
    groupId: string,
    entity: HassEntity,
  ): HTMLElement {
    const cacheKey = `${groupId}:${entity.entity_id}`;
    const config = this._getInlineCardConfig(groupId, entity);
    const hash = JSON.stringify(config);
    const cached = this._inlineCardElementCache.get(cacheKey);

    if (cached?.hash === hash) {
      (cached.el as LovelaceCard).hass = this.hass;
      return cached.el;
    }

    const synchronous = createCardElementSynchronous(this.hass, config);
    if (synchronous) {
      (synchronous as LovelaceCard).hass = this.hass;
      this._inlineCardElementCache.set(cacheKey, {
        hash,
        el: synchronous,
      });
      return synchronous;
    }

    const placeholder = document.createElement("div");
    placeholder.classList.add("inline-card-placeholder");
    this._inlineCardElementCache.set(cacheKey, { hash, el: placeholder });
    createCardElement(this.hass, config)
      .then((element) => {
        const current = this._inlineCardElementCache.get(cacheKey);
        if (current?.el !== placeholder || current.hash !== hash) return;
        (element as LovelaceCard).hass = this.hass;
        placeholder.replaceWith(element);
        this._inlineCardElementCache.set(cacheKey, { hash, el: element });
      })
      .catch((error) => {
        console.debug(
          "status-card-delayed: Failed to create inline card for entity:",
          entity.entity_id,
          error,
        );
      });
    return placeholder;
  }

  private _pruneInlineCardCache(
    entities: Array<{ entity: HassEntity; contextKey: string }>,
  ): void {
    const visibleKeys = new Set(
      entities.map(
        ({ entity, contextKey }) => `${contextKey}:${entity.entity_id}`,
      ),
    );
    for (const key of this._inlineCardElementCache.keys()) {
      if (!visibleKeys.has(key)) this._inlineCardElementCache.delete(key);
    }
  }

  private _getInlineEntities(
    personEntities: HassEntity[],
    items: AnyItem[],
  ): Array<{ entity: HassEntity; contextKey: string }> {
    const result: Array<{ entity: HassEntity; contextKey: string }> = [];
    const included = new Set<string>();

    const append = (entities: HassEntity[], contextKey: string) => {
      for (const entity of entities) {
        if (included.has(entity.entity_id)) continue;
        included.add(entity.entity_id);
        result.push({ entity, contextKey });
      }
    };

    append(personEntities, "person");

    for (const item of items) {
      if (item.type === "extra") {
        append([item.entity], item.panel);
        continue;
      }

      if (item.type === "group") {
        append(this._getGroupEntities(item.ruleset), item.group_id);
        continue;
      }

      const deviceClass =
        item.type === "deviceClass" ? item.deviceClass : undefined;
      const entities = this._shouldShowTotalEntities(
        item.domain,
        deviceClass,
      )
        ? this._totalEntities(item.domain, deviceClass)
        : this._isOn(item.domain, deviceClass);
      append(entities, typeKey(item.domain, deviceClass));
    }

    return result;
  }

  private _getInlineSectionTitle(item: AnyItem): string {
    if (item.type === "extra") return item.name;
    if (item.type === "group") return item.group_id;

    const deviceClass =
      item.type === "deviceClass" ? item.deviceClass : undefined;
    return (
      getCustomName(this._config, item.domain, deviceClass) ||
      this.computeLabel({ name: deviceClass || item.domain })
    );
  }

  private _renderInlineEntities(
    items: AnyItem[],
    inlineEntities: Array<{ entity: HassEntity; contextKey: string }>,
  ): TemplateResult {
    const entitiesByContext = new Map<
      string,
      Array<{ entity: HassEntity; contextKey: string }>
    >();
    for (const inlineEntity of inlineEntities) {
      const section = entitiesByContext.get(inlineEntity.contextKey) || [];
      section.push(inlineEntity);
      entitiesByContext.set(inlineEntity.contextKey, section);
    }

    const sections: Array<{
      key: string;
      title: string;
      entities: Array<{ entity: HassEntity; contextKey: string }>;
    }> = [];
    const people = entitiesByContext.get("person");
    if (people?.length) {
      sections.push({
        key: "person",
        title: this.computeLabel({ name: "person" }),
        entities: people,
      });
    }

    for (const item of items) {
      const contextKey =
        item.type === "extra"
          ? item.panel
          : item.type === "group"
            ? item.group_id
            : typeKey(
                item.domain,
                item.type === "deviceClass" ? item.deviceClass : undefined,
              );
      const entities = entitiesByContext.get(contextKey);
      if (!entities?.length) continue;
      sections.push({
        key: contextKey,
        title: this._getInlineSectionTitle(item),
        entities,
      });
    }

    return html`
      <div
        class="inline-entity-sections"
        style=${styleMap(this._parsedGlobalCardCss)}
      >
        ${repeat(
          sections,
          (section) => section.key,
          (section) => html`
            <section class="inline-entity-section">
              <div class="inline-section-title">${section.title}</div>
              <div class="inline-entity-grid">
                ${repeat(
                  section.entities,
                  ({ entity }) => entity.entity_id,
                  ({ entity, contextKey }) => html`
                    <div
                      class="inline-entity-card"
                      data-animation-key=${`entity:${entity.entity_id}`}
                    >
                      ${this._getOrCreateInlineCard(contextKey, entity)}
                    </div>
                  `,
                )}
              </div>
            </section>
          `,
        )}
      </div>
    `;
  }

  private _sortInlineEntitiesByActivation(
    entities: Array<{ entity: HassEntity; contextKey: string }>,
  ): Array<{ entity: HassEntity; contextKey: string }> {
    if (this._config.sort_entities !== true) {
      return entities;
    }

    return entities
      .map((item, index) => ({
        item,
        index,
        activatedAt: Date.parse(item.entity.last_changed),
      }))
      .sort((a, b) => {
        const aTime = Number.isFinite(a.activatedAt) ? a.activatedAt : 0;
        const bTime = Number.isFinite(b.activatedAt) ? b.activatedAt : 0;
        return aTime - bTime || a.index - b.index;
      })
      .map(({ item }) => item);
  }

  private renderItemTab(item: DomainItem | DeviceClassItem): TemplateResult {
    const domain = item.domain;
    const deviceClass = (item as DeviceClassItem).deviceClass;

    const visibleActive = this._isOn(domain, deviceClass);
    const currentlyActive = this._currentlyActiveEntities(
      domain,
      deviceClass,
    );
    const total = this._totalEntities(domain, deviceClass);
    const showTotal = this._shouldShowTotalEntities(domain, deviceClass);
    const entities = showTotal ? total : visibleActive;
    if (!entities.length) return html``;

    const color = getCustomColor(
      this._config,
      domain,
      deviceClass,
      this._custMap,
    );
    const customization = this.getCustomizationForType(
      typeKey(domain, deviceClass),
    );
    const badgeOnlyActiveEntities =
      this._config.badge_only_active_entities ?? true;
    const badgeCount = badgeOnlyActiveEntities
      ? currentlyActive.length
      : entities.length;

    const name =
      getCustomName(this._config, domain, deviceClass, undefined, this._custMap) ||
      this.computeLabel({ name: deviceClass || domain });

    let stateText;
    if (this._shouldShowTotalNumbers(domain, deviceClass)) {
      stateText = `${currentlyActive.length}/${total.length} ${getStatusProperty(
        this.hass,
        this._config,
        domain,
        deviceClass,
        undefined,
        this._custMap,
      )}`;
    } else if (this._shouldShowTotalEntities(domain, deviceClass)) {
      stateText = `${total.length}`;
    } else {
      stateText = `${currentlyActive.length} ${getStatusProperty(
        this.hass,
        this._config,
        domain,
        deviceClass,
        undefined,
        this._custMap,
      )}`;
    }

    return this._renderTabShell({
      panel: deviceClass || domain,
      animationKey: this._animationKeyForItem(item),
      badgeCount,
      handler: this._handleDomainAction(domain, deviceClass),
      customization,
      iconType: "domain",
      color,
      background_color: getBackgroundColor(
        this._config,
        domain,
        deviceClass,
        this._custMap,
      ),
      count: entities.length,
      entityClass: "entity",
      icon: this._renderIcon(
        getCustomIcon(
          this._config,
          domain,
          deviceClass,
          undefined,
          this._custMap,
        ),
      ),
      name,
      state: stateText,
    });
  }

  private renderPersonTab(entity: HassEntity): TemplateResult {
    const entityState = this.hass!.states[entity.entity_id];
    const isNotHome = entityState?.state !== "home";
    const contentClasses = {
      horizontal: this._config.content_layout === "horizontal",
    };
    const iconStyles = {
      "border-radius": this._config?.square ? "20%" : "50%",
      filter: isNotHome ? "grayscale(100%)" : "none",
    };

    const personHomeColor = this._config.person_home_color;
    const personAwayColor = this._config.person_away_color;
    const personHomeIcon = this._config.person_home_icon || "mdi:home";
    const personAwayIcon =
      this._config.person_away_icon || "mdi:home-export-outline";

    const badgeColor = isNotHome
      ? personAwayColor || "red"
      : personHomeColor || "green";

    const badgeIcon = isNotHome ? personAwayIcon : personHomeIcon;

    return html`
      <ha-tab-group-tab
        slot="nav"
        data-animation-key=${`person:${entity.entity_id}`}
        @action=${this._handlePersonAction(entity)}
        .actionHandler=${this._computeActionHandler(false, false)}
        class=${designClass(this.design)}
      >
        ${this.design === "badge"
          ? html`<div
              class="person-badge"
              style=${styleMap({
                "--status-card-delayed-badge-color": toCssColor(badgeColor),
                "--status-card-delayed-badge-text-color": toCssColor(
                  this.badge_text_color,
                ),
              })}
            >
              ${this._renderIcon(badgeIcon)}
            </div>`
          : ""}
        <div class="entity ${classMap(contentClasses)}">
          <div class="entity-icon" style=${styleMap(iconStyles)}>
            ${entity.attributes.entity_picture
              ? html`<img
                  src=${entity.attributes.entity_picture}
                  alt=${entity.attributes.friendly_name ||
                  entity.entity_id}
                  style=${styleMap(iconStyles)}
                />`
              : entity.attributes.icon?.startsWith("M")
                ? html`<ha-svg-icon
                    class="center"
                    .path=${entity.attributes.icon}
                    style=${styleMap(iconStyles)}
                  ></ha-svg-icon>`
                : html`<ha-icon
                    class="center"
                    icon=${entity.attributes.icon || "mdi:account"}
                    style=${styleMap(iconStyles)}
                  ></ha-icon>`}
          </div>
          ${this.design !== "badge"
            ? html`<div class="entity-info">
                ${!this.hide_content_name
                  ? html`<div class="entity-name">
                      ${entity.attributes.friendly_name?.split(
                        " ",
                      )[0] || ""}
                    </div>`
                  : ""}
                <div class="entity-state">
                  ${getStatusProperty(
                    this.hass!,
                    this._config,
                    "person",
                    undefined,
                    entityState?.state,
                    this._custMap,
                  )}
                </div>
              </div>`
            : ""}
        </div>
      </ha-tab-group-tab>
    `;
  }

  private _computeSortedEntities = memoizeOne(
    (
      extra: ExtraItem[],
      group: GroupItem[],
      domain: DomainItem[],
      deviceClass: DeviceClassItem[],
    ): AnyItem[] =>
      [...extra, ...group, ...domain, ...deviceClass].sort(
        (a, b) => a.order - b.order,
      ),
  );

  protected renderTab(item: AnyItem): TemplateResult {
    switch (item.type) {
      case "extra":
        return this.renderExtraTab(item);

      case "group":
        return this.renderGroupTab(item.ruleset, item.order);
      case "domain":
      case "deviceClass":
        return this.renderItemTab(item);
    }
  }

  private _renderGroupedEntities(
    personEntities: HassEntity[],
    items: AnyItem[],
  ): TemplateResult {
    const visibleItems = items.filter((item) =>
      this._isGroupedItemVisible(item),
    );
    const classes = {
      "no-scroll": !!this._config.no_scroll,
      "badge-mode": this.design === "badge",
      "chip-mode": this.design === "chip",
      square: !!this._config.square,
      "no-background": this.no_background,
    };

    return html`
      <ha-card
        class=${classMap(classes)}
        style=${styleMap(this._parsedGlobalCardCss)}
      >
        <ha-tab-group without-scroll-controls class=${classMap(classes)}>
          <ha-tab-group-tab style="display:none" active></ha-tab-group-tab>
          ${repeat(
            personEntities,
            (entity) => entity.entity_id,
            (entity) => this.renderPersonTab(entity),
          )}
          ${repeat(
            visibleItems,
            (item) =>
              item.type === "extra"
                ? item.panel
                : item.type === "domain"
                  ? item.domain
                  : item.type === "deviceClass"
                    ? `${item.domain}-${item.deviceClass}`
                    : `group-${item.group_id}`,
            (item) => this.renderTab(item),
          )}
        </ha-tab-group>
      </ha-card>
    `;
  }

  protected render() {
    if (this._shouldHideCard) {
      return html``;
    }

    const extra = this.getExtraItems();
    const group = this.getGroupItems();
    const domain = this.getDomainItems();
    const deviceClass = this.getDeviceClassItems();

    const sorted = this._computeSortedEntities(
      extra,
      group,
      domain,
      deviceClass,
    );

    const personEntities = this.getPersonItems();
    const inlineEntities = this._sortInlineEntitiesByActivation(
      this._getInlineEntities(personEntities, sorted),
    );
    if (this._config.ungroup_entities) {
      this._pruneInlineCardCache(inlineEntities);
    } else if (this._inlineCardElementCache.size) {
      this._inlineCardElementCache.clear();
    }
    let content: TemplateResult = html``;
    if (!this._shouldHideCard) {
      content = !this._config.ungroup_entities
        ? this._renderGroupedEntities(personEntities, sorted)
        : this._renderInlineEntities(sorted, inlineEntities);
    }

    return html`
      <div class="tile-animation-layer" aria-hidden="true"></div>
      ${content}
    `;
  }

  static get styles() {
    return [cardStyles];
  }

  static getConfigElement() {
    return document.createElement("status-card-delayed-editor");
  }

  static getStubConfig() {
    return {};
  }
}
