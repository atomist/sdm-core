import {
    ProgressTest,
    testProgressReporter,
} from "@atomist/sdm/api-helper/goal/progress/progress";

export const NpmProgressTests: ProgressTest[] = [{
    test: /Invoking goal hook: pre/g,
    label: "installing dependencies",
}, {
    test: /> atomist git/g,
    label: "generating resources",
}, {
    test: /> tsc --project \./g,
    label: "compiling sources",
}, {
    test: /> nyc mocha/g,
    label: "testing",
},{
    test: /> mocha --exit/g,
    label: "testing",
}, {
    test: /Sending build context to Docker daemon/g,
    label: "building Docker image",
}, {
    test: /The push refers to a repository/g,
    label: "pushing Docker image"
}];

export const NpmProgressReporter = testProgressReporter(NpmProgressTests);