import fs from 'fs';
import path from 'path';

export const loader = async () => {
  const filePath = path.resolve('public', 'demo.html');
  const html = fs.readFileSync(filePath, 'utf8');

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html',
      'Content-Security-Policy': "frame-ancestors https://admin.shopify.com https://*.myshopify.com;",
    },
  });
};

export default function LiveApp() {
  return null;
}
