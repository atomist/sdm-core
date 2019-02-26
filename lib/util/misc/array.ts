export function toArray<T>(value: T | T[]): T[] {
    if (!!value) {
        if (Array.isArray(value)) {
            return value;
        } else {
            return [value];
        }
    } else {
        return undefined;
    }
}
