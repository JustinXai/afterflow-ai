import fs from 'fs';
import path from 'path';

export const loader = async () => {
  const filePath = path.resolve('public', 'demo.html');
  const html = fs.readFileSync(filePath, 'utf8');

  const apiKey = process.env.SHOPIFY_API_KEY ?? '';
  const host  = 'HOST_PLACEHOLDER';

  const injectedHtml = html.replace(
    /<\/body>/i,
    `<script src="https://unpkg.com/@shopify/app-bridge@3"></script>
    <script>
      (function () {
        var params = new URLSearchParams(window.location.search);
        var host   = params.get('host') || '';
        var apiKey = '${apiKey}';

        if (window.top !== window.self && apiKey) {
          var AppBridge = window['app-bridge'];
          if (AppBridge && AppBridge.createApp) {
            AppBridge.createApp({ apiKey: apiKey, host: host });
          }
        }
      })();
    </script>
  </body>`
  );

  return new Response(injectedHtml, {
    headers: {
      'Content-Type': 'text/html',
      'Content-Security-Policy': "frame-ancestors https://admin.shopify.com https://*.myshopify.com;",
    },
  });
};

export default function LiveApp() {
  return null;
}
