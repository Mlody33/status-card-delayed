<h1 id="top" align="center">Status Card Delayed</h1>

<p align="center">
  <img src="https://raw.githubusercontent.com/xbourner/status-card/main/.github/img/status-card-headerv2.png" alt="Status Card Delayed Header" width="100%">
</p>

<p align="center">
  <a href="https://github.com/hacs/integration">
    <img src="https://img.shields.io/badge/hacs-default-orange.svg?style=for-the-badge" alt="HACS">
  </a>
  <a href="https://github.com/Mlody33/status-card-delayed/releases">
    <img src="https://img.shields.io/github/downloads/Mlody33/status-card-delayed/total?style=for-the-badge" alt="GitHub Downloads">
  </a>
  <a href="https://github.com/Mlody33/status-card-delayed/releases/">
    <img src="https://img.shields.io/github/release/Mlody33/status-card-delayed?style=for-the-badge" alt="GitHub release">
  </a>
  <a href="https://github.com/Mlody33/status-card-delayed">
    <img src="https://img.shields.io/github/stars/Mlody33/status-card-delayed?style=for-the-badge" alt="Stars">
  </a>
  <a href="https://github.com/Mlody33/status-card-delayed/issues">
    <img src="https://img.shields.io/github/issues/Mlody33/status-card-delayed?style=for-the-badge" alt="Issues">
  </a>
</p>

## Overview

**Status Card Delayed** is a powerful custom card for Home Assistant Dashboards that provides a comprehensive overview of your entities without the need for constant updates.

I always wanted to make an overview card that shows a lot of entities without the need to change it almost every day. This card will show all relevant data in a quick look. You only need to assign your entities/devices to your areas and the card will do the rest.

<p align="center">
  <img width="49%" alt="Light Mode" src="https://raw.githubusercontent.com/xbourner/status-card/main/.github/img/status-card-light.png">
&nbsp; 
  <img width="49%" alt="Dark Mode" src="https://raw.githubusercontent.com/xbourner/status-card/main/.github/img/status-card-dark.png">
</p>

**Note:** This card is highly influenced by [Dwains Dashboard](https://github.com/dwainscheeren/dwains-lovelace-dashboard). Now you can use this great idea as a single card in all of your Dashboards.

## 📥⚙️ Documentation

For more Info visit the [Documentation](https://xbourner.github.io/card-docu/status-card/).

### Fork configuration and upstream compatibility

This fork keeps `recently_active_seconds`, `sort_entities`, `ungroup_entities`,
`inline_feature`, animated tiles, and `badge_only_active_entities` (default: `true`).
Delayed entities remain visible while badge counts show currently active entities;
set `badge_only_active_entities: false` to count all visible entities instead.

Use `display_mode: standard`, `badge`, or `chip` on the card or an item. Existing
`badge_mode: true/false` configurations still work; `display_mode` takes precedence
when both are set. The editor exposes the new display mode selector.

The local `docs/` directory preserves this fork's earlier documentation. Refer to
the upstream documentation linked above for new display modes and count styles.

Build with `npm ci && npm run build`. Run `npm test` for the build and DOM regression
tests. The Home Assistant resource remains `status-card-delayed.js`, and the card
type remains `custom:status-card-delayed`.

### Features on entity cards inside sections

With `ungroup_entities: true`, open the visual editor's domain/device-class
customizations, add a domain, smart group, or individual entity, and select its
**Entity card features** tab (**Funkcje kart** in Polish). The embedded Home Assistant
card editor lets you add, remove, reorder and configure features, including their
position. For a domain or group, select a representative entity to show the
features supported by that entity. This selection is only used by the editor.

Settings are saved under `customization[].inline_card`. The most specific override
wins: individual entity, then section/group, then domain/device class. Each override
configures the whole entity card. **Restore inherited settings** removes the local
override. These settings apply to section cards; popup settings remain separate.
Existing `popup_card` configurations continue to work as a fallback.

For example, show a heating thermostat's target-temperature control inline:

```yaml
type: custom:status-card-delayed
ungroup_entities: true
content:
  - climate
customization:
  - type: climate
    inline_card:
      type: tile
      features_position: inline
      features:
        - type: target-temperature
```

Use `type: climate.your_thermostat` instead of `type: climate` to customize only
one thermostat. Use `features: []` to hide all controls. For heating mode buttons,
use `type: climate-hvac-modes` with `hvac_modes: [heat, "off"]`; the native editor
shows the options supported by the selected entity. See the
[Home Assistant feature documentation](https://www.home-assistant.io/dashboards/features/)
for other controls.

### 🎥 Video Tutorial

Want to see the Status Card Delayed in action? Check out this excellent showcase and tutorial video (🇩🇪 German language):

[![Status Card Delayed Tutorial](https://img.youtube.com/vi/z4j6qpBgrYU/0.jpg)](https://www.youtube.com/watch?v=z4j6qpBgrYU)

## ❤️ Support My Work

Developing and maintaining custom cards takes a lot of time and coffee. If you enjoy using Status Card Delayed and want to support its ongoing development, I would greatly appreciate it!

<p align="center">
  <a href="https://discord.gg/RfVx7hmZD3">
    <img src="https://img.shields.io/discord/1341456711835455609?style=for-the-badge&logo=discord&logoColor=%237289da&label=Discord&color=%237289da" alt="Discord">
  </a>
  <a href="https://www.buymeacoffee.com/bourner">
    <img src="https://img.shields.io/badge/Buy%20Me%20a%20Coffee-ffdd00?&logo=buy-me-a-coffee&logoColor=black&style=for-the-badge" alt="Buy Me A Coffee">
  </a>
  <a href="https://github.com/sponsors/xBourner">
    <img src="https://img.shields.io/badge/Sponsor%20on%20GitHub-30363d?style=for-the-badge&logo=github&logoColor=white" alt="GitHub Sponsors">
  </a>
  <a href="https://www.paypal.me/gibgas123">
    <img src="https://img.shields.io/badge/PayPal-003087?logo=paypal&logoColor=fff&style=for-the-badge" alt="PayPal">
  </a>
</p>

Join the <a href="https://discord.gg/RfVx7hmZD3">**community Discord server**</a> to leave feedback, request features, or get help with your configuration.

---

[🔝 Back to top](#top)
