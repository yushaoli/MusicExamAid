# Exporter Test Matrix (Template v2.1, Strict Mode)

## Template/header integrity
- Duplicate headers → ERR_TEMPLATE_DUPLICATE_HEADER
- Missing required header → ERR_TEMPLATE_MISSING_REQUIRED_HEADER
- Unknown headers → OK (leave blank)

## Snapshot & eligibility
- reg not Locked → ERR_REG_NOT_LOCKED
- snapshot_json missing → ERR_SNAPSHOT_MISSING

## Field validation
- required blank → ERR_REQUIRED_FIELD_EMPTY
- enum invalid → ERR_ENUM_INVALID
- DOB unparseable → ERR_DATE_PARSE
