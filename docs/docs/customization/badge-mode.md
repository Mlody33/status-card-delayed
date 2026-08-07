---
title: Badge Mode
---

# Badge Mode

Compact display: icon + badge count instead of a full content item. Badge mode is disabled at default.

- **Global:** `badge_mode: true` enables badge mode for all items
- **Per Item:** Individually enable per item via customization
- **Active-only count:** `badge_only_active_entities: true` excludes entities kept visible by `recently_active_seconds`
- **Person Badges:** Show home/away icons

<img class="doc-img-responsive" src="../img/badge_mode.png" alt="Badge Mode Feature">

---

## Editor Settings

| Option | Description |
|--------|-------------|
| **Badge Mode** | Enable badge mode (global or per item) |
| **Count Only Currently Active Entities** | Exclude recently inactive entities from the badge count |
| **Badge Color** | Global badge color |
| **Badge Text Color** | Global badge text color |


<img class="doc-img-responsive" src="../img/badge_editor.png" alt="Badge Mode Editor">

---

## YAML Example

```yaml
type: custom:status-card-delayed
badge_mode: true
badge_only_active_entities: true
badge_color: red
badge_text_color: white
```
