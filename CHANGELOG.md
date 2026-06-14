# Changelog

All notable changes to this project are documented here. This project follows
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Breaking Changes

- **Removed the deprecated flat evidence fields `evidence_required` and
  `evidence_types`.** These were superseded by the nested `evidence:` object and
  are no longer parsed, validated, or rendered. The parser now throws a clear
  migration error if either field appears in a step (or rollback step).

  **Migration** — replace:

  ```yaml
  - name: Deploy
    command: kubectl apply -f deployment.yaml
    evidence_required: true
    evidence_types: [command_output]
  ```

  with the nested form:

  ```yaml
  - name: Deploy
    command: kubectl apply -f deployment.yaml
    evidence:
      required: true
      types: [command_output]
  ```

  All bundled examples, fixtures, and the `init`/`create` scaffolding templates
  already use the nested form.
