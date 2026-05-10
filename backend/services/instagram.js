const axios = require('axios');

const BASE_URL = 'https://graph.instagram.com/v19.0';

function getCredentials() {
  const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN;
  const userId = process.env.INSTAGRAM_USER_ID;
  if (!accessToken || !userId) {
    throw new Error('Instagram credentials not configured in .env');
  }
  return { accessToken, userId };
}

// Step 1: Create a media container (text-only / caption post with image URL)
async function createMediaContainer(caption, imageUrl = null) {
  const { accessToken, userId } = getCredentials();

  const params = {
    caption,
    access_token: accessToken,
  };

  if (imageUrl) {
    params.image_url = imageUrl;
    params.media_type = 'IMAGE';
  } else {
    // Instagram requires an image — use a default branded background image
    // You can replace this with your own hosted image URL
    params.image_url =
      'https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?w=1080&q=80';
    params.media_type = 'IMAGE';
  }

  const res = await axios.post(`${BASE_URL}/${userId}/media`, null, { params });
  return res.data.id;
}

// Step 2: Publish the container
async function publishMedia(containerId) {
  const { accessToken, userId } = getCredentials();

  const res = await axios.post(`${BASE_URL}/${userId}/media_publish`, null, {
    params: {
      creation_id: containerId,
      access_token: accessToken,
    },
  });

  return res.data.id;
}

async function postToInstagram(caption, imageUrl = null) {
  const containerId = await createMediaContainer(caption, imageUrl);
  // Instagram requires a short wait between container creation and publish
  await new Promise((resolve) => setTimeout(resolve, 3000));
  const postId = await publishMedia(containerId);
  return postId;
}

module.exports = { postToInstagram };
