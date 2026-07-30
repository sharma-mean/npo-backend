// Allowed enum-ish values for the daily contact-book report (連絡帳). Stored as
// plain strings/arrays on DailyReport so the set can grow without a migration;
// the service validates every incoming value against these lists.

const VIGOR_MIN = 1;
const VIGOR_MAX = 5;

// 気持ち・状態 — multi-select
const STATES = [
  "HIGH_ANXIETY",
  "CALM",
  "SENSITIVE",
  "TIRED",
  "SLEEP_DEPRIVED",
  "SELF_INJURY",
  "AGGRESSIVE",
  "NORMAL",
];

// 夜中に起きた回数
const NIGHT_WAKINGS = ["NONE", "ONCE", "TWICE_PLUS"];

// 持ち物チェック — multi-select
const BELONGINGS = [
  "CHANGE_OF_CLOTHES",
  "LUNCH_BAG",
  "TOOTHBRUSH_CUP",
  "DIAPERS",
  "PADS",
  "INDOOR_SHOES",
];

// 送迎 — pickup / drop-off method
const TRANSPORT = ["BUS", "GUARDIAN", "DAY_SERVICE", "OTHER"];

const MANAGER_ROLES = ["NPO_ADMIN", "COORDINATOR"];
const AUTHOR_ROLES = ["NPO_ADMIN", "COORDINATOR", "STAFF"];

module.exports = {
  VIGOR_MIN,
  VIGOR_MAX,
  STATES,
  NIGHT_WAKINGS,
  BELONGINGS,
  TRANSPORT,
  MANAGER_ROLES,
  AUTHOR_ROLES,
};
