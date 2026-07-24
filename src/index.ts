import packageJson from "../package.json";
import "./card";
import "./editor";

console.info(
  `%c STATUS-CARD-DELAYED %c ${packageJson.version} `,
  "color: steelblue; background: black; font-weight: bold;",
  "color: white ; background: dimgray; font-weight: bold;"
);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "status-card-delayed",
  name: "Status Card Delayed",
  preview: true,
  description:
    "A custom card that displays active entities grouped by domain/device class.",
});

window.customBadges = window.customBadges || [];
window.customBadges.push({
  type: "status-card-delayed",
  name: "Status Card Delayed",
  preview: true,
  description:
    "A custom card that displays active entities grouped by domain/device class.",
});
