import { Parameterized } from "@atomist/sdm/lib/api/goal/GoalWithFulfillment";

export interface AtomistYaml {

    skill: {
        id?: string;
        name: string;
        version: string;

        title: string;
        description: string;
        category: string[];
        technology: string[];
        author: string;
        license: string;
        homepage: string;
        repository: string;
        icon: string;

        package: PackageUse | PackageUse[];

        runtime: {
            timeout: number;
            memory: 128 | 256 | 512 | 1024 | 2048;
            entryPoint: string;
            name: "nodejs10" | "python37" | "go113";
        }
    }

    commands?: Array<{
        name: string;
        description: string;
        pattern: string;
    }>;

    subscriptions?: string[];
    ingesters?: string[];
}

export interface PackageUse extends Parameterized {
    use: string;
}
