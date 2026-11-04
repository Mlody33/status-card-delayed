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
