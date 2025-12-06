export type EnvironmentVariableValue = Array<{
  value: string;
  version: number;
  user: string;
  createdAt: string;
}>;

export type ProjectConfig = {
  name: string;
  environment?: string;
  [key: string]: any;
};