/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @n8n/community-nodes/no-deprecated-workflow-functions */

import {
  IExecuteFunctions,
  IDataObject,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
  NodeConnectionTypes,
  NodeOperationError,
} from 'n8n-workflow';

/**
 * Instagram Guest Scraper Node.
 * * This node implements a "Grey Hat" scraping technique that mimics a guest user (non-logged)
 * visiting the Instagram web interface. It relies on a Cookie Handshake followed by 
 * a specific GraphQL query.
 * * @version 1.0.0
 * @author Ernane Ferreira
 */
export class InstagramGuest implements INodeType {
  /**
   * The node definition that appears in the n8n UI.
   * Configures the inputs, outputs, icons, and parameters.
   */
  description: INodeTypeDescription = {
    displayName: 'Instagram Guest Scraper',
    name: 'instagramGuest',
    icon: { 
      light: 'file:instagram.svg', 
      dark: 'file:instagram.dark.svg' 
    },
    group: ['transform'],
    version: 1,
    description: 'Retrieves media and metadata from Instagram posts using the Guest/GraphQL method.',
    defaults: {
      name: 'Instagram Guest',
    },
    usableAsTool: true, // Enables usage within AI Agents as a tool
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    properties: [
      {
        displayName: 'Post URL or Shortcode',
        name: 'postUrlOrShortcode',
        type: 'string',
        default: '',
        placeholder: 'e.g. https://www.instagram.com/p/CxYz123/ or CxYz123',
        description: 'The full URL of the post or the specific shortcode ID',
        required: true,
      },
    ],
  };

  /**
   * Executes the node logic.
   * * The workflow consists of 4 atomic steps:
   * 1. **Handshake:** Request the homepage to obtain session cookies.
   * 2. **CSRF Extraction:** Parse cookies to find the CSRF token required for POST requests.
   * 3. **GraphQL Query:** Send the payload to the internal Instagram API using the `doc_id`.
   * 4. **Parsing:** Normalize the complex GraphQL response into a clean JSON structure.
   * * @param this The n8n execution context helper.
   * @returns A Promise resolving to the workflow data.
   */
  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const returnData: INodeExecutionData[] = [];

    // Standard User-Agent to mimic a real browser to reduce blocking probability
    const userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

    /**
     * INTERNAL API CONSTANT.
     * This ID represents the `PolarisPostActionLoadPostQuery` or similar.
     * * @warning This ID rotates periodically. If the node fails with 400/500 errors, 
     * this ID likely needs to be updated via reverse engineering the web client.
     * @lastUpdated 2026-01-31
     */
    const GRAPHQL_DOC_ID = '9510064595728286';

    for (let i = 0; i < items.length; i++) {
      try {
        const inputStr = this.getNodeParameter('postUrlOrShortcode', i) as string;
        let shortcode = inputStr;

        // Extract shortcode if a full URL is provided (supports p, reel, tv)
        const urlMatch = inputStr.match(/(?:p|reel|tv|reels)\/([A-Za-z0-9_-]+)/);
        if (urlMatch && urlMatch[1]) {
          shortcode = urlMatch[1];
        }

        // --- Capture Cookies (Handshake) ---
        // 'any' casting used to bypass strict type check for 'resolveWithFullResponse' 
        // which is valid in n8n's request implementation but missing in @types/request
        const optionsStep1: any = { 
          method: 'GET',
          uri: 'https://www.instagram.com/',
          headers: { 'User-Agent': userAgent },
          resolveWithFullResponse: true,
          json: true,
        };

        const response1 = await this.helpers.request(optionsStep1);

        // --- Extract CSRF Token ---
        const cookies = response1.headers['set-cookie'];
        if (!cookies) {
          throw new NodeOperationError(this.getNode(), 'Instagram did not return any cookies. The IP might be blocked.');
        };

        const csrfCookie = cookies.find((c: string) => c.includes('csrftoken='));
        if (!csrfCookie) {
          throw new NodeOperationError(this.getNode(), 'CSRF Token not found in cookies.');
        };

        const csrfToken = csrfCookie.split(';')[0].replace('csrftoken=', '');

        // --- GraphQL Data Retrieval ---
        const variables = JSON.stringify({
          shortcode: shortcode,
          fetch_tagged_user_count: null,
          hoisted_comment_id: null,
          hoisted_reply_id: null,
        });

        const optionsStep2: any = {
          method: 'POST',
          uri: 'https://www.instagram.com/graphql/query',
          headers: {
            'User-Agent': userAgent,
            'X-CSRFToken': csrfToken,
            'Content-Type': 'application/x-www-form-urlencoded',
            'Cookie': csrfCookie, // Critical: session cookie must be present
          },
          form: {
            variables: variables,
            doc_id: GRAPHQL_DOC_ID,
          },
          json: true,
        };

        const response2 = await this.helpers.request(optionsStep2);

        // --- Parse Data ---
        const mediaRoot = response2.data?.xdt_shortcode_media;

        if (!mediaRoot) {
          throw new NodeOperationError(this.getNode(), 'No data returned. Post might be private or request blocked.');
        };

        const mediaDetails: IDataObject[] = [];
        const urlList: string[] = [];

        /**
         * Helper to normalize Video/Image objects into a standard format
         */
        const formatMedia = (node: any) => {
          if (node.is_video) {
            return {
              type: 'video',
              dimensions: node.dimensions,
              video_view_count: node.video_view_count,
              url: node.video_url,
              thumbnail: node.display_url,
            };
          }
          return {
            type: 'image',
            dimensions: node.dimensions,
            url: node.display_url,
          };
        };

        // Handle Sidecar (Carousel) vs Single Media
        if (mediaRoot.__typename === 'XDTGraphSidecar') {
          if (mediaRoot.edge_sidecar_to_children?.edges) {
            mediaRoot.edge_sidecar_to_children.edges.forEach((edge: any) => {
              const media = formatMedia(edge.node);
              mediaDetails.push(media);
              urlList.push(media.url as string);
            });
          };
        } else {
          const media = formatMedia(mediaRoot);
          mediaDetails.push(media);
          urlList.push(media.url as string);
        };

        const captionEdges = mediaRoot.edge_media_to_caption?.edges;
        const caption = (captionEdges && captionEdges.length > 0) ? captionEdges[0].node.text : '';

        returnData.push({
          json: {
            shortcode,
            results_count: urlList.length,
            url_list: urlList,
            post_info: {
              owner_username: mediaRoot.owner?.username,
              owner_fullname: mediaRoot.owner?.full_name,
              is_verified: mediaRoot.owner?.is_verified,
              is_private: mediaRoot.owner?.is_private,
              likes_count: mediaRoot.edge_media_preview_like?.count,
              is_ad: mediaRoot.is_ad,
              caption,
            },
            media_details: mediaDetails,
          },
        });

      } catch (error) {
        if (this.continueOnFail()) {
          returnData.push({ json: { error: error.message } });
          continue;
        };
        throw error;
      };
    };

    return [returnData];
  };
};