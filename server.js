require("isomorphic-fetch");
const dotenv = require("dotenv");
const Koa = require("koa");
const next = require("next");
const { default: createShopifyAuth } = require("@shopify/koa-shopify-auth");
const { verifyRequest } = require("@shopify/koa-shopify-auth");
const session = require("koa-session");
dotenv.config();
const { default: graphQLProxy } = require("@shopify/koa-shopify-graphql-proxy");
const { ApiVersion } = require("@shopify/koa-shopify-graphql-proxy");
const getSubscriptionUrl = require("./server/getSubscriptionUrls");
const Router = require("koa-router");
const {
  receiveWebhook,
  registerWebhook,
} = require("@shopify/koa-shopify-webhooks");

const port = parseInt(process.env.PORT, 10) || 3000;
const dev = process.env.NODE_ENV !== "production";
const app = next({ dev });
const handle = app.getRequestHandler();

const { SHOPIFY_API_SECRET_KEY, SHOPIFY_API_KEY, HOST } = process.env;

//--PREPARE THE APP
app.prepare().then(() => {
  const server = new Koa();
  const router = new Router();
  server.use(session({ secure: true, sameSite: "none" }, server));
  server.keys = [SHOPIFY_API_SECRET_KEY];

  //--SET UP AUTHENTICATION
  server.use(
    createShopifyAuth({
      apiKey: SHOPIFY_API_KEY,
      secret: SHOPIFY_API_SECRET_KEY,
      scopes: ["read_products", "write_products"],
      async afterAuth(ctx) {
        const { shop, accessToken } = ctx.session;
        ctx.cookies.set("shopOrigin", shop, {
          httpOnly: false,
          secure: true,
          sameSite: "none",
        });

        //--ATTEMPT TO REGISTER WEBHOOK
        const registration = await registerWebhook({
          address: `${HOST}/webhooks/products/create`,
          topic: "PRODUCTS_CREATE",
          accessToken,
          shop,
          apiVersion: ApiVersion.July20,
        });

        if (registration.success) {
          console.log("Sucessfully registered webhook");
        } else {
          console.log("Failed to register webhook", registration.result);
        }

        //--SETS UP BILLING PLAN
        await getSubscriptionUrl(ctx, accessToken, shop);
      },
    })
  );

  const webhook = receiveWebhook({ secret: SHOPIFY_API_SECRET_KEY });

  router.post("/webhooks/products/create", webhook, (ctx) => {
    console.log("Recieved webhook: ", ctx.state.webhook);
  });

  //--PROXY USED TO SECURELY REQUEST DATA FROM SHOPIFY. KEEP AS UP TO DATE AS POSSIBLE
  server.use(graphQLProxy({ version: ApiVersion.July20 }));

  router.get("(.*)", verifyRequest(), async (ctx) => {
    await handle(ctx.req, ctx.res);
    ctx.respond = false;
    ctx.res.statusCode = 200;
  });
  server.use(router.allowedMethods());
  server.use(router.routes());

  server.listen(port, () => {
    console.log(`> Ready on http://localhost${port}`);
  });
});
