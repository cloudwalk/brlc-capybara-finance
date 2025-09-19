export interface Version {
  major: number;
  minor: number;
  patch: number;

  [key: string]: number; // Index signature to ensure that fields are iterated over in a key-value style
}

export const EXPECTED_VERSION: Version = {
  major: 1,
  minor: 20,
  patch: 0,
};
