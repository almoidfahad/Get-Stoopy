# Inventory calculator clarity and reset

The vendor stock calculator now states its allowed on-hand range and the relationship between reserved and on-hand units before entry. A local-only clear button removes both values and any validation error, returning keyboard focus to the first input; it is disabled when both fields are empty. This does not read, update, or save inventory.

Verification: calculation and component interaction tests, full unit/component suite, typecheck, and production web build. In local Chromium at 320, 390 and 1440 CSS pixels, keyboard clear and focus return, validation recovery, document overflow and Axe automated checks passed. Automated accessibility checks are not a complete accessibility audit; no live store, inventory mutation, or authenticated vendor workflow was tested.
