/// <reference path="./.sst/platform/config.d.ts" />
export default $config({
  app(input) {
    return {
      name: "box-rush",
      home: "aws",
      providers: { aws: { region: "ap-northeast-1" } },
      removal: input?.stage === "production" ? "retain" : "remove",
      protect: input?.stage === "production",
    };
  },
  async run() {
    await import("./infra/stack");
  },
});
