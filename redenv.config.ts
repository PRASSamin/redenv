import { defineConfig } from "@redenv/core";

export default defineConfig({
  environment: "development",
  name: "redenv",
  plugins: [
    {
      name: "test",
      version: "1.0.0",
      commands: [
        {
          name: "tests",
          description: "test",
          args: [
            {
              name: "key",
              description: "key to remove",
              required: false,
              defaultValue: "asd",
            },
            {
              name: "value",
              description: "value to remove",
              required: false,
              multiple: true,
              defaultValue: "asd",
            },
          ],
          flags: [
            {
              name: "value",
              description: "value to remove",
              defaultValue: "asda",
            },
          ],
          action: async (args, flags, { config, redis, cwd }) => {
            console.log(args);
            console.log(flags);
            console.log(config);
            console.log(redis);
            console.log(cwd);
            console.log(await redis.keys("*"));
          },
        },
      ],
    },
  ],
});
