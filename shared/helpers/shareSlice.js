const { ensureBrowserId } = require('./browserId');

const SHARE_PATH = '/api/share';

async function shareSlice(file) {
  let browserId = 'anonymous';
  try {
    browserId = ensureBrowserId();
  } catch (err) {
    console.error({ err });
    /* pass */
  }

  const filename = file.name;
  const formData = new FormData();
  formData.append('file', file, filename);

  const promise = fetch(SHARE_PATH, {
    method: 'POST',
    body: formData,
    headers: {
      'X-Browser-Id': browserId,
    },
  });

  try {
    const response = await promise;

    if (response.status !== 201) {
      const err = new Error('Server Error');
      err.response = response;
      throw err;
    }

    const data = await response.json();
    return data.id;
  } catch (err) {
    console.error({ err });
    throw err;
  }
}

module.exports = shareSlice;
