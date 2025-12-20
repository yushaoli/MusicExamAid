# 05 Export (Template v2.1)

## Contract
- Export unit: SuperBatch only
- Row source: RegistrationRecord.snapshot_json
- Column order: dictated by template header row; must not change

## Writer algorithm
1) Open template workbook
2) Read header row cells into headers_in_order
3) For each output row:
   - for each header in headers_in_order:
     - lookup mapping spec (by header text)
     - extract value from snapshot_json using mapping path
     - apply formatter
     - write to that cell
4) Save as new file (store in object storage)

## Validation
- preflight (no XLSX) checks required fields + enums + date formats
- export fails fast if preflight has blocking errors
