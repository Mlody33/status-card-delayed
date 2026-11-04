import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { Window } from 'happy-dom';

const window = new Window({ url: 'http://localhost/' });
for (const key of ['window', 'document', 'customElements', 'HTMLElement', 'Element', 'Document', 'DocumentFragment', 'ShadowRoot', 'CSSStyleSheet', 'CustomEvent', 'Event', 'Node', 'MutationObserver']) {
  globalThis[key] = key === 'window' ? window : window[key];
}
globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
// Exercise reduced-motion rendering without depending on a browser layout engine.
window.matchMedia = () => ({ matches: true });
class TileCard extends HTMLElement {
  setConfig(config) { this.config = config; }
}
customElements.define('hui-tile-card', TileCard);
window.loadCardHelpers = async () => ({
  createCardElement(config) {
    const card = document.createElement('hui-tile-card');
    card.setConfig(config);
    return card;
  },
});
await import('../dist/status-card-delayed.js');
after(() => window.happyDOM.abort());
const timestamp = new Date().toISOString();
const entity = (id, state, changed = timestamp) => ({
  entity_id: id, state, last_changed: changed, last_updated: changed,
  attributes: { friendly_name: id }, context: { id: 'test' },
});
const initialStates = () => ({
  'light.a': entity('light.a', 'on'),
  'light.b': entity('light.b', 'off'),
  'person.test': entity('person.test', 'home'),
});
function hass(states = initialStates()) {
  return {
    states,
    entities: Object.fromEntries(Object.keys(states).map(id => [id, {
      entity_id: id, area_id: 'room', labels: ['label1'], hidden: false,
    }])),
    devices: {}, areas: { room: { area_id: 'room', name: 'Room', floor_id: null } },
    themes: { themes: {}, darkMode: false, theme: 'default' },
    locale: { language: 'en' }, language: 'en', localize: () => '',
  };
}
const base = { type: 'custom:status-card-delayed', content: ['light'], hide_person: true, recently_active_seconds: 60 };
async function mount(config = {}, states) {
  const card = document.createElement('status-card-delayed');
  card.setConfig({ ...base, ...config });
  card.hass = hass(states);
  document.body.append(card);
  await card.updateComplete;
  return card;
}
const tile = card => card.shadowRoot.querySelector('[data-animation-key="domain:light"]');

test('fork registers isolated card and editor names', () => {
  for (const name of ['status-card-delayed', 'status-card-delayed-editor', 'status-card-delayed-item-editor', 'status-card-delayed-items-editor']) {
    assert.ok(customElements.get(name), name);
  }
  assert.equal(customElements.get('status-card'), undefined);
  assert.equal(customElements.get('status-items-editor'), undefined);
});

test('legacy badge mode keeps delayed tiles but counts currently active entities', async () => {
  const card = await mount({ badge_mode: true });
  assert.ok(tile(card).classList.contains('badge-mode'));
  assert.equal(tile(card).querySelector('.count-badge').textContent, '1');
  card.hass = { ...card.hass, states: { ...card.hass.states, 'light.a': entity('light.a', 'off') } };
  await card.updateComplete;
  assert.ok(tile(card));
  assert.equal(tile(card).querySelector('.count-badge'), null);
  card.remove();
});

test('display modes and count styles coexist with delayed badge options', async () => {
  const card = await mount({ display_mode: 'chip', badge_mode: true, customization: [{ type: 'light', styles: { count: [{ min: 2, icon: 'color: red;' }] } }] });
  assert.ok(tile(card).classList.contains('chip-mode'));
  assert.equal(tile(card).querySelector('.entity-icon').style.color, 'red');
  card.setConfig({ ...base, display_mode: 'badge', badge_only_active_entities: false });
  await card.updateComplete;
  assert.equal(tile(card).querySelector('.count-badge').textContent, '2');
  card.setConfig({ ...base, display_mode: 'chip', customization: [{ type: 'light', badge_mode: true }] });
  await card.updateComplete;
  assert.ok(tile(card).classList.contains('badge-mode'));
  card.remove();
});

test('delay expiration removes the last tile and hides an empty card', async () => {
  const states = { 'light.a': entity('light.a', 'off', new Date(Date.now() - 900).toISOString()) };
  const card = await mount({ hide_card_if_empty: true, recently_active_seconds: 1 }, states);
  assert.ok(tile(card));
  await new Promise(resolve => setTimeout(resolve, 250));
  await card.updateComplete;
  assert.equal(tile(card), null);
  assert.equal(card.hidden, true);
  card.remove();
});

test('smart groups retain recent entities, label filters and current badge counts', async () => {
  const ruleset = { group_id: 'Lights', filters: [{ key: 'domain', value: 'light' }, { key: 'state', value: 'on' }, { key: 'label', value: 'Living' }] };
  const card = await mount({ content: ['Lights'], rulesets: [ruleset], display_mode: 'badge' });
  card.__registryEntities = Object.values(card.hass.entities);
  card.__registryAreas = Object.values(card.hass.areas);
  card.labels = [{ label_id: 'label1', name: 'Living' }];
  await card.updateComplete;
  const group = card.shadowRoot.querySelector('[data-animation-key="group:Lights"]');
  assert.ok(group);
  assert.equal(group.querySelector('.count-badge').textContent, '1');
  card.hass = { ...card.hass, states: { ...card.hass.states, 'light.a': entity('light.a', 'off') } };
  await card.updateComplete;
  assert.equal(card._getGroupEntities(ruleset).length, 2);
  assert.equal(group.querySelector('.count-badge'), null);
  card.remove();
});

test('ungrouped entity cards keep activation ordering and inline tile features', async () => {
  const card = await mount({ ungroup_entities: true, sort_entities: true, inline_feature: true });
  const cards = card.shadowRoot.querySelectorAll('.inline-entity-card');
  assert.equal(cards.length, 2);
  assert.ok(cards[0].querySelector('hui-tile-card'));
  assert.deepEqual([...cards].map(el => el.dataset.animationKey), ['entity:light.a', 'entity:light.b']);
  card.remove();
});

test('people and extra entities render in the chip design', async () => {
  const card = await mount({ display_mode: 'chip', hide_person: false, content: ['light.a'], extra_entities: ['light.a'] });
  assert.ok(card.shadowRoot.querySelector('[data-animation-key="person:person.test"]').classList.contains('chip-mode'));
  assert.ok(card.shadowRoot.querySelector('[data-animation-key="extra:light.a"]').classList.contains('chip-mode'));
  card.remove();
});

test('registry changes refresh visibility without changing entity state', async () => {
  const card = await mount({ hide_card_if_empty: true });
  assert.ok(tile(card));
  card.hass = { ...card.hass, entities: Object.fromEntries(Object.entries(card.hass.entities).map(([id, entry]) => [id, { ...entry, hidden: true }])) };
  await card.updateComplete;
  assert.equal(tile(card), null);
  assert.equal(card.hidden, true);
  card.remove();
});

test('editors translate legacy badge settings to display mode', async () => {
  const editor = document.createElement('status-card-delayed-editor');
  editor.setConfig({ ...base, badge_mode: true });
  assert.equal(editor._config.display_mode, 'badge');
  editor.setConfig({ ...base, badge_mode: true, display_mode: 'chip' });
  assert.equal(editor._config.display_mode, 'chip');
  const item = document.createElement('status-card-delayed-item-editor');
  item.config = { type: 'light', badge_mode: true };
  item.hass = hass();
  item.getSchema = 'domain';
  document.body.append(item);
  await item.updateComplete;
  assert.equal(item._config.display_mode, 'badge');
  item.remove();
});

test('remote inline sections preserve domain order and sort entities by activation time', async () => {
  const states = {
    'light.a': entity('light.a', 'on', '2026-01-02T00:00:00Z'),
    'light.b': entity('light.b', 'on', '2026-01-01T00:00:00Z'),
    'switch.a': entity('switch.a', 'on'),
  };
  const card = await mount({ ungroup_entities: true, sort_entities: true, content: ['switch', 'light'], customization: [{ type: 'light', name: 'Lights' }, { type: 'switch', name: 'Switches' }] }, states);
  const sections = [...card.shadowRoot.querySelectorAll('.inline-entity-section')];
  assert.equal(sections.length, 2);
  assert.deepEqual(sections.map(section => section.querySelector('.inline-section-title').textContent.trim()), ['Switches', 'Lights']);
  assert.deepEqual([...sections[1].querySelectorAll('.inline-entity-card')].map(el => el.dataset.animationKey), ['entity:light.b', 'entity:light.a']);
  card.remove();
});

const thermostat = () => ({
  ...entity('climate.heating', 'heat'),
  attributes: { friendly_name: 'Heating', current_temperature: 20, temperature: 21, hvac_modes: ['heat', 'off'], supported_features: 1 },
});
const targetTemperature = [{ type: 'target-temperature' }];

test('section cards accept climate features and per-entity overrides without changing popups', async () => {
  const climate = thermostat();
  const card = await mount({
    content: ['climate'], ungroup_entities: true,
    customization: [{ type: 'climate', inline_card: { type: 'tile', features: targetTemperature, features_position: 'inline' } }],
  }, { [climate.entity_id]: climate });
  let rendered = card.shadowRoot.querySelector('hui-tile-card');
  assert.deepEqual(rendered.config.features, targetTemperature);
  assert.equal(rendered.config.features_position, 'inline');
  assert.equal(rendered.config.entity, climate.entity_id);
  const popup = document.createElement('status-card-delayed-popup');
  popup.card = card;
  popup.hass = card.hass;
  popup.selectedDomain = 'climate';
  assert.equal(popup._getPopupCardConfig(climate).features[0].type, 'climate-hvac-modes');

  card.setConfig({ ...card._config, customization: [
    ...card._config.customization,
    { type: climate.entity_id, inline_card: { type: 'tile', features: [], entity: 'climate.other' } },
  ] });
  await card.updateComplete;
  rendered = card.shadowRoot.querySelector('hui-tile-card');
  assert.deepEqual(rendered.config.features, []);
  assert.equal(rendered.config.entity, climate.entity_id);
  card.remove();
});

test('inline overrides follow entity, section, domain precedence and keep legacy cards', async () => {
  const climate = thermostat();
  const card = await mount({ content: ['climate'], customization: [
    { type: 'climate', popup_card: { type: 'tile', name: 'Legacy' }, inline_card: { type: 'tile', name: 'Domain', features: targetTemperature } },
    { type: 'Heating group', popup_card: { type: 'thermostat' }, inline_card: { type: 'tile', name: 'Group', features: [] } },
    { type: climate.entity_id, inline_card: { type: 'tile', name: 'Entity', features: targetTemperature } },
  ] }, { [climate.entity_id]: climate });
  assert.equal(card._getInlineCardConfig('Heating group', climate).name, 'Entity');
  card.setConfig({ ...card._config, customization: card._config.customization.slice(0, 2) });
  assert.equal(card._getInlineCardConfig('Heating group', climate).name, 'Group');
  card.setConfig({ ...card._config, customization: [card._config.customization[0], { type: 'Heating group', popup_card: { type: 'thermostat' } }] });
  assert.equal(card._getInlineCardConfig('Heating group', climate).name, 'Domain');
  card.setConfig({ ...card._config, customization: [
    { type: 'climate', popup_card: { type: 'tile', name: 'Legacy' } },
    { type: 'Heating group', popup_card: { type: 'thermostat' } },
  ] });
  assert.equal(card._getInlineCardConfig('Heating group', climate).type, 'thermostat');
  assert.equal(card._getInlineCardConfig('climate', climate).name, 'Legacy');
  card.remove();
});

test('feature editor saves and clears features, restores inheritance and keeps preview local', async () => {
  const climate = thermostat();
  const item = document.createElement('status-card-delayed-item-editor');
  item.config = { type: 'Heating group' };
  item.parentConfig = { ...base, customization: [item.config] };
  item.hass = hass({ [climate.entity_id]: climate });
  item.isGroup = true;
  item.getSchema = 'domain';
  item._activeTab = 'inline';
  document.body.append(item);
  await item.updateComplete;
  let changed;
  item.addEventListener('config-changed', event => { changed = event.detail.config; });
  item.shadowRoot.querySelector('ha-selector').dispatchEvent(new CustomEvent('value-changed', { detail: { value: climate.entity_id } }));
  await item.updateComplete;
  assert.equal(changed, undefined);
  let editor = item.shadowRoot.querySelector('hui-card-element-editor');
  assert.equal(editor.value.entity, climate.entity_id);
  editor.dispatchEvent(new CustomEvent('config-changed', { detail: { config: { type: 'tile', entity: climate.entity_id, features: targetTemperature, features_position: 'inline' } } }));
  await item.updateComplete;
  assert.deepEqual(changed.inline_card.features, targetTemperature);
  assert.equal(changed.inline_card.entity, undefined);
  assert.equal(changed.inline_card.features_position, 'inline');
  // Saving in the parent must retain the group's selected preview entity.
  item.config = changed;
  await item.updateComplete;
  editor = item.shadowRoot.querySelector('hui-card-element-editor');
  assert.ok(editor);
  editor.dispatchEvent(new CustomEvent('config-changed', { detail: { config: { type: 'tile', entity: climate.entity_id } } }));
  await item.updateComplete;
  assert.deepEqual(changed.inline_card.features, []);
  assert.deepEqual(item.shadowRoot.querySelector('hui-card-element-editor').value.features, []);
  item.shadowRoot.querySelector('ha-button').click();
  await item.updateComplete;
  assert.equal(changed.inline_card, undefined);
  assert.equal(item.shadowRoot.querySelector('hui-card-element-editor').value.features[0].type, 'climate-hvac-modes');
  item.remove();
});

test('individual entities are available for customization without adding extra cards', () => {
  const climate = thermostat();
  const editor = document.createElement('status-card-delayed-editor');
  editor.hass = hass({ [climate.entity_id]: climate });
  editor.setConfig({ ...base, content: ['climate'], ungroup_entities: true });
  assert.ok(editor.contentSelectOptions.some(option => option.value === climate.entity_id));
  assert.equal(editor._config.extra_entities, undefined);
  assert.deepEqual(editor._config.content, ['climate']);
});

test('entity feature tab is assigned to the HA navigation slot and opens on click', async () => {
  const item = document.createElement('status-card-delayed-item-editor');
  item.config = { type: 'climate' };
  item.hass = hass({ 'climate.heating': thermostat() });
  item.getSchema = 'domain';
  document.body.append(item);
  await item.updateComplete;
  const tabs = [...item.shadowRoot.querySelectorAll('ha-tab-group-tab')];
  assert.equal(tabs.length, 5);
  assert.ok(tabs.every(tab => tab.slot === 'nav' && tab.hasAttribute('panel')));
  const featureTab = tabs.find(tab => tab.getAttribute('panel') === 'inline');
  assert.ok(featureTab);
  featureTab.click();
  await item.updateComplete;
  assert.ok(item.shadowRoot.querySelector('hui-card-element-editor'));
  item.remove();
});

test('Entities rows open the selected thermostat feature editor independently of hide filter', async () => {
  const climate = thermostat();
  const editor = document.createElement('status-card-delayed-editor');
  editor.hass = hass({ [climate.entity_id]: climate, 'light.a': entity('light.a', 'on') });
  editor.setConfig({ ...base, ungroup_entities: true, content: ['climate', 'light'], hide_filter: 'area' });
  document.body.append(editor);
  await editor.updateComplete;
  const button = editor.shadowRoot.querySelector('.entity-features[data-entity-id="climate.heating"]');
  assert.ok(button);
  let saves = 0;
  editor.addEventListener('config-changed', () => saves++);
  button.click();
  await editor.updateComplete;
  let native = editor.shadowRoot.querySelector('hui-card-element-editor');
  assert.equal(native.value.entity, climate.entity_id);
  // HA sends config-changed on initialization; opening must not create an override.
  native.dispatchEvent(new CustomEvent('config-changed', { detail: { config: native.value } }));
  assert.equal(saves, 0);
  native.dispatchEvent(new CustomEvent('config-changed', { detail: { config: {
    ...native.value, features: targetTemperature, features_position: 'inline',
  } } }));
  await editor.updateComplete;
  const override = editor._config.customization.find(item => item.type === climate.entity_id);
  assert.deepEqual(override.inline_card.features, targetTemperature);
  assert.equal(override.inline_card.features_position, 'inline');
  assert.equal(override.inline_card.entity, undefined);
  assert.equal(editor._config.extra_entities, undefined);
  native = editor.shadowRoot.querySelector('hui-card-element-editor');
  native.dispatchEvent(new CustomEvent('config-changed', { detail: { config: { type: 'tile', entity: climate.entity_id, features_position: 'inline' } } }));
  await editor.updateComplete;
  assert.deepEqual(editor._config.customization.find(item => item.type === climate.entity_id).inline_card.features, []);
  editor.shadowRoot.querySelector('ha-button').click();
  await editor.updateComplete;
  assert.equal(editor._config.customization.find(item => item.type === climate.entity_id).inline_card, undefined);
  native = editor.shadowRoot.querySelector('hui-card-element-editor');
  const before = saves;
  native.dispatchEvent(new CustomEvent('config-changed', { detail: { config: native.value } }));
  assert.equal(saves, before);
  editor.shadowRoot.querySelector('ha-icon-button').click();
  await editor.updateComplete;
  assert.ok(editor.shadowRoot.querySelector('.entity-features[data-entity-id="climate.heating"]'));
  const card = await mount({ ...editor._config, customization: [{ type: climate.entity_id, inline_card: override.inline_card }] }, { [climate.entity_id]: climate });
  assert.deepEqual(card.shadowRoot.querySelector('hui-tile-card').config.features, targetTemperature);
  card.remove();
  editor.remove();
});

test('feature buttons include extra entities outside area filters and covers without device class', async () => {
  const editor = document.createElement('status-card-delayed-editor');
  editor.hass = hass({ 'climate.heating': thermostat(), 'cover.blind': entity('cover.blind', 'open') });
  editor.hass = { ...editor.hass, entities: { 'cover.blind': editor.hass.entities['cover.blind'] } };
  editor.setConfig({ ...base, ungroup_entities: true, extra_entities: ['climate.heating'], content: ['climate.heating', 'cover'] });
  document.body.append(editor);
  await editor.updateComplete;
  assert.ok(editor.shadowRoot.querySelector('.entity-features[data-entity-id="climate.heating"]'));
  assert.ok(editor.shadowRoot.querySelector('.entity-features[data-entity-id="cover.blind"]'));
  editor.remove();
});
