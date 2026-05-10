const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');

const BASE_URL = 'https://graph.instagram.com/v19.0';

function getCredentials() {
  const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN;
  const userId = process.env.INSTAGRAM_USER_ID;
  if (!accessToken || !userId) throw new Error('Instagram credentials not configured in .env');
  return { accessToken, userId };
}

// Upload image to catbox.moe (free, no auth, permanent hosting)
async function uploadImageToHost(filepath) {
  const form = new FormData();
  form.append('reqtype', 'fileupload');
  form.append('fileToUpload', fs.createReadStream(filepath));
  const res = await axios.post('https://catbox.moe/user/api.php', form, {
    headers: form.getHeaders(),
    timeout: 30000,
  });
  const url = res.data.trim();
  console.log(`[Instagram] Uploaded image → ${url}`);
  return url;
}

// Create a single carousel item container (not published on its own)
async function createCarouselItem(imageUrl) {
  const { accessToken, userId } = getCredentials();
  const res = await axios.post(`${BASE_URL}/${userId}/media`, null, {
    params: {
      image_url: imageUrl,
      media_type: 'IMAGE',
      is_carousel_item: true,
      access_token: accessToken,
    },
  });
  return res.data.id;
}

// Create the carousel album container
async function createCarouselContainer(childIds, caption) {
  const { accessToken, userId } = getCredentials();
  const res = await axios.post(`${BASE_URL}/${userId}/media`, null, {
    params: {
      media_type: 'CAROUSEL',
      children: childIds.join(','),
      caption,
      access_token: accessToken,
    },
  });
  return res.data.id;
}

// Publish the carousel
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

async function postCarousel(imagePaths, caption) {
  console.log(`[Instagram] Uploading ${imagePaths.length} images...`);

  // Upload all images to public host
  const imageUrls = [];
  for (const fp of imagePaths) {
    const url = await uploadImageToHost(fp);
    imageUrls.push(url);
  }

  // Create individual carousel item containers
  const childIds = [];
  for (const url of imageUrls) {
    const id = await createCarouselItem(url);
    childIds.push(id);
    console.log(`[Instagram] Carousel item created: ${id}`);
    await new Promise((r) => setTimeout(r, 1000));
  }

  // Create carousel container
  const carouselId = await createCarouselContainer(childIds, caption);
  console.log(`[Instagram] Carousel container: ${carouselId}`);

  // Wait before publishing (Instagram recommendation)
  await new Promise((r) => setTimeout(r, 3000));

  const postId = await publishMedia(carouselId);
  console.log(`[Instagram] Published carousel: ${postId}`);
  return postId;
}

module.exports = { postCarousel };
