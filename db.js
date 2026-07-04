/* Loomify IndexedDB Storage Helper */

const DB_NAME = 'LoomifyDB';
const DB_VERSION = 1;
const STORE_NAME = 'videos';

window.db = {
  dbInstance: null,

  init() {
    return new Promise((resolve, reject) => {
      if (this.dbInstance) {
        return resolve(this.dbInstance);
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };

      request.onsuccess = (event) => {
        this.dbInstance = event.target.result;
        resolve(this.dbInstance);
      };

      request.onerror = (event) => {
        console.error('IndexedDB open error:', event.target.error);
        reject(event.target.error);
      };
    });
  },

  async saveVideo(videoData) {
    const database = await this.init();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      
      const record = {
        id: videoData.id,
        title: videoData.title || 'Minha Gravação',
        blob: videoData.blob,
        size: videoData.blob.size,
        date: videoData.date || new Date().toISOString(),
        views: videoData.views || 1,
        comments: videoData.comments || []
      };

      const request = store.put(record);

      request.onsuccess = () => resolve(record);
      request.onerror = (event) => reject(event.target.error);
    });
  },

  async getVideo(id) {
    const database = await this.init();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(id);

      request.onsuccess = () => resolve(request.result);
      request.onerror = (event) => reject(event.target.error);
    });
  },

  async getAllVideos() {
    const database = await this.init();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => {
        // Sort by date descending (newest first)
        const sorted = (request.result || []).sort((a, b) => new Date(b.date) - new Date(a.date));
        resolve(sorted);
      };
      request.onerror = (event) => reject(event.target.error);
    });
  },

  async deleteVideo(id) {
    const database = await this.init();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(id);

      request.onsuccess = () => resolve(true);
      request.onerror = (event) => reject(event.target.error);
    });
  },

  async updateVideoTitle(id, newTitle) {
    const record = await this.getVideo(id);
    if (!record) throw new Error('Video not found');
    record.title = newTitle;
    return this.saveVideo(record);
  },

  async incrementViews(id) {
    try {
      const record = await this.getVideo(id);
      if (record) {
        record.views = (record.views || 0) + 1;
        await this.saveVideo(record);
      }
    } catch (e) {
      console.warn('Could not increment views', e);
    }
  },

  async addComment(id, author, content) {
    const record = await this.getVideo(id);
    if (!record) throw new Error('Video not found');
    
    const comment = {
      id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2),
      author: author || 'Anônimo',
      content: content,
      date: new Date().toISOString()
    };

    record.comments.push(comment);
    await this.saveVideo(record);
    return comment;
  }
};
