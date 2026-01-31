# n8n-nodes-instagram-guest

This is an unofficial community node for [n8n](https://n8n.io/) that allows you to download media (Images, Videos, Reels, Carousels) and metadata from Instagram posts without requiring an official API Key.

It utilizes the "Guest" method (Cookie Handshake + GraphQL), making it perfect for low-volume scraping or personal automation workflows.

![n8n-instagram-node](https://raw.githubusercontent.com/ernanej/n8n-nodes-instagram-guest/main/assets/preview.png)
## Features

- **No Credentials Required:** Works out-of-the-box acting as a guest user.
- **Media Support:** Downloads Images, Videos, and full Carousels.
- **Metadata Extraction:** Gets caption, like count, owner info, and dimensions.
- **Smart Parsing:** Accepts full URLs (`https://instagram.com/p/...`) or just Shortcodes.
- **AI Ready:** Can be used as a Tool by AI Agents within n8n.

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation.

1. Go to **Settings > Community Nodes**.
2. Select **Install**.
3. Enter `n8n-nodes-instagram-guest`.

## Usage

1. Add the **Instagram Guest Scraper** node to your workflow.
2. In the **Post URL or Shortcode** field, paste a link:
   - `https://www.instagram.com/p/CxYz123/`
   - `https://www.instagram.com/reels/ABcDeFg/`
   - Or just the ID: `CxYz123`
3. The node will output a JSON containing `url_list` (array of download links) and `media_details`.

## ⚠️ Limitations & Rate Limiting

This node operates by mimicking a browser guest session.
- **Rate Limits:** Instagram is aggressive with IP blocking. If you use this node heavily (e.g., hundreds of requests per hour), your n8n server IP may be temporarily blocked by Instagram.
- **Data Centers:** Requests from known cloud providers (AWS, DigitalOcean, etc.) are more likely to be flagged than residential IPs.
- **Private Accounts:** Cannot access posts from private accounts.

## License

MIT