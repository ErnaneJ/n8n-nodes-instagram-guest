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

export class InstagramGuest implements INodeType {
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
		usableAsTool: true,
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

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		// Standard User-Agent to mimic a real browser
		const userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

		// Internal Instagram GraphQL Document ID (2026-01-31)
		const GRAPHQL_DOC_ID = '9510064595728286';

		for (let i = 0; i < items.length; i++) {
			try {
				const inputStr = this.getNodeParameter('postUrlOrShortcode', i) as string;
				let shortcode = inputStr;

				// Extract shortcode if a full URL is provided
				const urlMatch = inputStr.match(/(?:p|reel|tv|reels)\/([A-Za-z0-9_-]+)/);
				if (urlMatch && urlMatch[1]) {
					shortcode = urlMatch[1];
				}

				// Capture Cookies (Handshake)
				const optionsStep1: any = { // ignore
					method: 'GET',
					uri: 'https://www.instagram.com/',
					headers: { 'User-Agent': userAgent },
					resolveWithFullResponse: true,
					json: true,
				};

				const response1 = await this.helpers.request(optionsStep1);

				// Extract CSRF Token
				const cookies = response1.headers['set-cookie'];
				if (!cookies) {
					throw new NodeOperationError(this.getNode(), 'Instagram did not return any cookies. The IP might be blocked.');
				};

				const csrfCookie = cookies.find((c: string) => c.includes('csrftoken='));
				if (!csrfCookie) {
					throw new NodeOperationError(this.getNode(), 'CSRF Token not found in cookies.');
				};

				const csrfToken = csrfCookie.split(';')[0].replace('csrftoken=', '');

				// GraphQL Data Retrieval
				const variables = JSON.stringify({
					shortcode: shortcode,
					fetch_tagged_user_count: null,
					hoisted_comment_id: null,
					hoisted_reply_id: null,
				});

				const optionsStep2: any = { // ignore
					method: 'POST',
					uri: 'https://www.instagram.com/graphql/query',
					headers: {
						'User-Agent': userAgent,
						'X-CSRFToken': csrfToken,
						'Content-Type': 'application/x-www-form-urlencoded',
						'Cookie': csrfCookie,
					},
					form: {
						variables: variables,
						doc_id: GRAPHQL_DOC_ID,
					},
					json: true,
				};

				const response2 = await this.helpers.request(optionsStep2);

				// Parse Data
				const mediaRoot = response2.data?.xdt_shortcode_media;

				if (!mediaRoot) {
					throw new NodeOperationError(this.getNode(), 'No data returned. Post might be private or request blocked.');
				};

				const mediaDetails: IDataObject[] = [];
				const urlList: string[] = [];

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