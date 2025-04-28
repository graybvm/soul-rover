import fetch from 'node-fetch';

async function getVersion() {
  try {
    const response = await fetch('http://localhost:3000/api/version');
    const data = await response.json();
    console.log('API Version:', data);
    return data;
  } catch (error) {
    console.error('Error fetching version:', error);
  }
}

// Call the function
getVersion(); 