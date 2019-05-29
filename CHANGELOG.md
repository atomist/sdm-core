# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/)
and this project adheres to [Semantic Versioning](http://semver.org/).

## [Unreleased](https://github.com/atomist/sdm-core/compare/1.5.0...HEAD)

### Changed

-   Reorder token resolution. [#149](https://github.com/atomist/sdm-core/issues/149)

## [1.5.0](https://github.com/atomist/sdm-core/compare/1.4.0...1.5.0) - 2019-05-27

### Added

-   Artifact caching. [#110](https://github.com/atomist/sdm-core/issues/110)
-   Enable multiple cache miss listeners and add a no-op cache. [#122](https://github.com/atomist/sdm-core/issues/122)
-   Add support for sending notifications on certain goal states. [#133](https://github.com/atomist/sdm-core/issues/133)
-   Support for goal contributions as data. [#146](https://github.com/atomist/sdm-core/issues/146)
-   Add delete and list to PreferenceStore api. [50c8c96](https://github.com/atomist/sdm-core/commit/50c8c9662cc8403b31cdd782a500ebbff7040511)

### Changed

-   Caching can now also handle complete directories. [#125](https://github.com/atomist/sdm-core/issues/125)
-   Enforced sdm local cache path on FileSystemGoalCache. [#130](https://github.com/atomist/sdm-core/issues/130)
-   Make tests safer, eliminate some axios use. [#134](https://github.com/atomist/sdm-core/issues/134)
-   Change rolar default buffer and flush settings. [904a94f](https://github.com/atomist/sdm-core/commit/904a94f088acedbc850552277d1bc46d633c576b)
-   Use configuration for rolar setup. [08436e8](https://github.com/atomist/sdm-core/commit/08436e84cdc554dcd95cf4568b5e6d6df9c0ea6c)
-   Deprecates deployer and artifact usage. [#147](https://github.com/atomist/sdm-core/issues/147)
-   Switch over to TeamConfiguration for sdm preferences. [#140](https://github.com/atomist/sdm-core/issues/140)

### Deprecated

-   Deprecates deployer and artifact usage. [#147](https://github.com/atomist/sdm-core/issues/147)
-   Switch over to TeamConfiguration for sdm preferences. [#140](https://github.com/atomist/sdm-core/issues/140)

## [1.4.0](https://github.com/atomist/sdm-core/compare/1.3.1...1.4.0) - 2019-04-01

### Changed

-   Update deps and version. [97c8365](https://github.com/atomist/sdm-core/commit/97c8365a288f8f984ad11487d72d5910c5e71812)

### Fixed

-   Fix issue when no verification keys are configured. [ed6628c](https://github.com/atomist/sdm-core/commit/ed6628c489cfac9e03f83a38d4290b6875ed8e25)

## [1.3.1](https://github.com/atomist/sdm-core/compare/1.3.0...1.3.1) - 2019-03-29

### Changed

-   Update k8s client. [#116](https://github.com/atomist/sdm-core/issues/116)
-   Use apiKey to query for isolated SDM goal. [#117](https://github.com/atomist/sdm-core/issues/117)

### Fixed

-   Goals that shouldn't be canceled get canceled. [#111](https://github.com/atomist/sdm-core/issues/111)

## [1.3.0](https://github.com/atomist/sdm-core/compare/1.2.0...1.3.0) - 2019-03-14

### Added

-   Add PreferenceStore implementations. [#93](https://github.com/atomist/sdm-core/issues/93)
-   Support parameter prompting from command listeners. [#95](https://github.com/atomist/sdm-core/issues/95)
-   Introduce goal signing and verification. [#100](https://github.com/atomist/sdm-core/issues/100)
-   Use a declared type for the configuration. [#101](https://github.com/atomist/sdm-core/issues/101)

### Changed

-   Make K8 goal scheduling more extensible. [#90](https://github.com/atomist/sdm-core/issues/90)
-   Move k8s goal launching into extension pack. [ccb6fbc](https://github.com/atomist/sdm-core/commit/ccb6fbcb0be52a7267936344a452c7b48703ac1b)
-   Only one worker for goal jobs. [119fea6](https://github.com/atomist/sdm-core/commit/119fea6022229389069f26c68475b34decf9447c)
-   Remove axios use in postWebhook. [#107](https://github.com/atomist/sdm-core/issues/107)

## [1.2.0](https://github.com/atomist/sdm-core/compare/1.1.0...1.2.0) - 2018-12-27

### Added

-   Add command to cancel in process goal set. [04e8484](https://github.com/atomist/sdm-core/commit/04e84846100aab4fcc1037613a520bd5b8672f8b)

### Changed

-   Move rolar log to use HttpClient and factory. [#87](https://github.com/atomist/sdm-core/issues/87)

## [1.1.0](https://github.com/atomist/sdm-core/compare/1.0.2...1.1.0) - 2018-12-08

### Added

-   Add support canceling goals. [#80](https://github.com/atomist/sdm-core/issues/80)
-   Add Gitlab support. [#81](https://github.com/atomist/sdm-core/issues/81)

## [1.0.2](https://github.com/atomist/sdm-core/compare/1.0.1...1.0.2) - 2018-11-09

### Fixed

-   Don't attempt to update GitHub status when running in local mode

## [1.0.1](https://github.com/atomist/sdm-core/compare/1.0.0...1.0.1) - 2018-11-09

## [1.0.0](https://github.com/atomist/sdm-core/compare/1.0.0-RC.2...1.0.0) - 2018-11-09

### Added

-   Use incoming event and command to retrieve token. [bcbc3b0](https://github.com/atomist/sdm-core/commit/bcbc3b033027aa79413d87b7d038ac729c7de4d6)

### Fixed

-   `GoalAutomationEventListener` always uses prod GraphQL urls. [#79](https://github.com/atomist/sdm-core/issues/79)

## [1.0.0-RC.2](https://github.com/atomist/sdm-core/compare/1.0.0-RC.1...1.0.0-RC.2) - 2018-10-30

### Added

-   Add ConfigurationBackedCredentialsResolver. [c1caf1a](https://github.com/atomist/sdm-core/commit/c1caf1a48a57e1903626993a719b1752918fb053)

### Changed

-   Don't approve goal if there are no success votes and only abstain. [#73](https://github.com/atomist/sdm-core/issues/73)
-   Move goals into subscription. [#75](https://github.com/atomist/sdm-core/issues/75)
-   Add commit-images link to GraphQL. [#77](https://github.com/atomist/sdm-core/issues/77)

### Fixed

-   Set goal state command doesn't get goals for multiple goal sets correct. [#76](https://github.com/atomist/sdm-core/issues/76)

## [1.0.0-RC.1](https://github.com/atomist/sdm-core/compare/1.0.0-M.5...1.0.0-RC.1) - 2018-10-15

### Changed

-   **BREAKING** Remove Builder indirection. [#68](https://github.com/atomist/sdm-core/issues/68)

### Removed

-   **BREAKING** Remove well known goals. [#67](https://github.com/atomist/sdm-core/issues/67)
-   Move build support to sdm-pack-build. [9a73bf9](https://github.com/atomist/sdm-core/commit/9a73bf9c6dbeb6092394a43f748194683ef7c535)
-   Moved build event handlers to build pack. [#69](https://github.com/atomist/sdm-core/issues/69)
-   Remove Atomist pre-code-build hook. [#70](https://github.com/atomist/sdm-core/issues/70)

## [1.0.0-M.5](https://github.com/atomist/sdm-core/compare/1.0.0-M.4...1.0.0-M.5) - 2018-09-26

### Added

-   Allow using async function to create SDM. [#57](https://github.com/atomist/sdm-core/pull/57)
-   New states for stopped and canceled goals. [#59](https://github.com/atomist/sdm-core/pull/59)
-   Support for code level project listeners. [#63](https://github.com/atomist/sdm-core/issues/63)

### Changed

-   **BREAKING** Export packs from the index as packs. [#62](https://github.com/atomist/sdm-core/pull/62)

### Removed

-   **BREAKING** Removed "freeze" pack. In sample-sdm pending a new home.

## [1.0.0-M.4](https://github.com/atomist/sdm-core/compare/1.0.0-M.3...1.0.0-M.4) - 2018-09-16

### Added

-   Prepare to hook in client startup events . [#48](https://github.com/atomist/sdm-core/issues/48)
-   Augment and organize export in index. [#52](https://github.com/atomist/sdm-core/issues/52)

### Changed

-   FingerprintInvocation contains a vector of Fingerprints. [#49](https://github.com/atomist/sdm-core/issues/49)
-   **BREAKING** Move to lib structure and use index. [#53](https://github.com/atomist/sdm-core/issues/53)
-   **BREAKING** Update from src to lib. [#54](https://github.com/atomist/sdm-core/issues/54)

### Removed

-   **BREAKING** Goal contexts no longer have an order but splitContext expects one. [#47](https://github.com/atomist/sdm-core/issues/47)

## [1.0.0-M.3](https://github.com/atomist/sdm-core/compare/1.0.0-M.1...1.0.0-M.3) - 2018-09-04

### Added

-   Stronger validation of required configration values. [#48a616b](https://github.com/atomist/sdm-core/commit/48a616bfbb304f5ca8f483aa91d1fd563f5dcbd8)
-   Add mergePullRequest flag to local config. [#7784157](https://github.com/atomist/sdm-core/commit/77841573c406f60796196ca1637a814e8bb52a2b)
-   Allow goals to receive implementations and listeners. [#41](https://github.com/atomist/sdm-core/issues/41)

### Changed

-   **BREAKING** Move local configuration into configuration object. [#34](https://github.com/atomist/sdm-core/issues/34)
-   **BREAKING** Moved "set goal state" and "reset goals" into an extension pack. Add it in your SDM if you want these: `sdm.addExtensionPacks(GoalState)`

### Removed

-   **BREAKING** Moved docker functionality to separate pack. [#44](https://github.com/atomist/sdm-core/issues/44)

## [1.0.0-M.1](https://github.com/atomist/sdm-core/compare/0.4.10...1.0.0-M.1) - 2018-08-27

## [0.4.10](https://github.com/atomist/sdm-core/compare/0.4.9...0.4.10) - 2018-08-27

## [0.4.9](https://github.com/atomist/sdm-core/compare/0.4.8...0.4.9) - 2018-08-24

## [0.4.8](https://github.com/atomist/sdm-core/compare/0.4.7...0.4.8) - 2018-08-24

## [0.4.7](https://github.com/atomist/sdm-core/compare/0.4.6...0.4.7) - 2018-08-23

## [0.4.6](https://github.com/atomist/sdm-core/compare/0.4.5...0.4.6) - 2018-08-22

## [0.4.5](https://github.com/atomist/sdm-core/compare/0.4.4...0.4.5) - 2018-08-21

## [0.4.4](https://github.com/atomist/sdm-core/compare/0.4.3...0.4.4) - 2018-08-21

## [0.4.3](https://github.com/atomist/sdm-core/compare/0.4.2...0.4.3) - 2018-08-21

## [0.4.2](https://github.com/atomist/sdm-core/compare/0.4.1...0.4.2) - 2018-08-17

## [0.4.1](https://github.com/atomist/sdm-core/compare/0.4.0...0.4.1) - 2018-08-09

### Fixed

-   Corrected GraphQL file/name agreement.

## [0.4.0](https://github.com/atomist/sdm-core/compare/0.2.4...0.4.0) - 2018-08-07

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

## [0.2.3](https://github.com/atomist/sdm-core/compare/0.2.2...0.2.3) - 2018-06-18

### Fixed

-   **BREAKING**  SeedDrivenGeneratorSupport allows you to override the seed. This fixes a bug with overriding the seed name.

## Earlier

### Added

-   Can provide tag when publishing NPM package. [#404](https://github.com/atomist/sdm-core/issues/404)

## [0.1.0](https://github.com/atomist/sdm-core/tree/0.1.0) - 2018-05-16

### Added

-   Everything.
