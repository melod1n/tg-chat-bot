export type BoundaryPrimitive = string | number | boolean | bigint | null | undefined;

export type BoundaryValue = BoundaryPrimitive | object | readonly BoundaryValue[];

export interface BoundaryRecord {
    readonly [key: string]: BoundaryValue;
}

export type ErrorLike = Error | string | BoundaryRecord;
