import { app } from "./server.js";

describe("server", () => {
  it("exports an Express app", () => {
    expect(typeof app.listen).toBe("function");
  });
});
