# Storage Directory

This directory contains:

- **Database files**: SQLite database files (`.sqlite`) - not committed to git
- **Source maps**: Uploaded source map files stored locally (can be migrated to S3/GCS later)

## Structure

```
storage/
  ├── data.sqlite          # Main SQLite database (gitignored)
  ├── sourcemaps/          # Source map files (gitignored)
  └── README.md            # This file
```

## Notes

- Database files are gitignored and should not be committed
- Source maps are stored by project and version
- Migration scripts will be added in later steps

