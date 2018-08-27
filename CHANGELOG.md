# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/)
and this project adheres to [Semantic Versioning](http://semver.org/).

## [Unreleased](https://github.com/atomist/sdm/compare/1.0.0-M.1...HEAD)

## [1.0.0-M.1](https://github.com/atomist/sdm/compare/0.4.10...1.0.0-M.1) - 2018-08-27

## [0.4.10](https://github.com/atomist/sdm/compare/0.4.9...0.4.10) - 2018-08-27

## [0.4.9](https://github.com/atomist/sdm/compare/0.4.8...0.4.9) - 2018-08-24

## [0.4.8](https://github.com/atomist/sdm/compare/0.4.7...0.4.8) - 2018-08-24

## [0.4.7](https://github.com/atomist/sdm/compare/0.4.6...0.4.7) - 2018-08-23

## [0.4.6](https://github.com/atomist/sdm/compare/0.4.5...0.4.6) - 2018-08-22

## [0.4.5](https://github.com/atomist/sdm/compare/0.4.4...0.4.5) - 2018-08-21

## [0.4.4](https://github.com/atomist/sdm/compare/0.4.3...0.4.4) - 2018-08-21

## [0.4.3](https://github.com/atomist/sdm/compare/0.4.2...0.4.3) - 2018-08-21

## [0.4.2](https://github.com/atomist/sdm/compare/0.4.1...0.4.2) - 2018-08-17

## [0.4.1](https://github.com/atomist/sdm/compare/0.4.0...0.4.1) - 2018-08-09

### Fixed

-   Corrected GraphQL file/name agreement.

## [0.4.0](https://github.com/atomist/sdm/compare/0.2.4...0.4.0) - 2018-08-07

### Added

-   Cleanup scheduled goal jobs on Kubernetes. [#4](https://github.com/atomist/sdm-core/issues/4)
-   EditorRegistration supports general editorCommand customizations, instead of specifically dryRun. If you were setting `dryRun = true`, set `editorCommandFactory = dryRunEditorCommand` instead.
-   ProjectVersioner function type receives an SdmGoalEvent instead of a Status fragment.
-   Differentiate between internal and external side-effecting fulfillment. [#9](https://github.com/atomist/sdm-core/issues/9)
-   Add ability to extract and report goal Progress. [#14](https://github.com/atomist/sdm-core/issues/14)
-   Add VoteOnGoalApprovalRequest. [#17](https://github.com/atomist/sdm-core/issues/17)
-   Attempt to configure local SDM. [#23](https://github.com/atomist/sdm-core/issues/23)

### Changed

-   Remove disposal command from default list of registered commands. [#5](https://github.com/atomist/sdm-core/issues/5)
-   **BREAKING** Removed "dry run" support. See `makeBuildAware` in `sdm`.
-   Allow configuration of status creation for NPM packages. [#10](https://github.com/atomist/sdm-core/issues/10)
-   **BREAKING** Removed Node and `npm` support. Moved to `sdm-pack-node`.

### Deprecated

-   Rename to GoalInvocation; deprecate status. [#2](https://github.com/atomist/sdm-core/issues/2)

### Fixed

-   **BREAKING** EditorRegistration supports general editorCommand customizations, instead of specifically dryRun.
-   Link is missing on npm publish goal. [#11](https://github.com/atomist/sdm-core/issues/11)
-   Use credentialsResolver consistently. [#18](https://github.com/atomist/sdm-core/issues/18)

## [0.2.3](https://github.com/atomist/sdm/compare/0.2.2...0.2.3) - 2018-06-18

### Fixed

-   **BREAKING**  SeedDrivenGeneratorSupport allows you to override the seed. This fixes a bug with overriding the seed name.

## Earlier

### Added

-   Can provide tag when publishing NPM package. [#404](https://github.com/atomist/sdm/issues/404)

## [0.1.0](https://github.com/atomist/sdm/tree/0.1.0) - 2018-05-16

### Added

-   Everything.
