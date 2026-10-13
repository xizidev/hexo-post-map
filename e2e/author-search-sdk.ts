/** Only the external POI service is substituted; packed author search code runs unchanged. */
export const authorSearchSdk = String.raw`
(() => {
  window.__authorSearchCalls = [];
  window.AMap.PlaceSearch = class {
    constructor(options) { this.options = options; }
    search(keyword, callback) {
      window.__authorSearchCalls.push({ keyword, options: this.options });
      const reply = () => {
        if (keyword === '额度受限') { callback('error', { info: 'DAILY_QUERY_OVER_LIMIT' }); return; }
        if (keyword === '无结果') { callback('no_data', {}); return; }
        callback('complete', { poiList: { pois: Array.from({ length: 10 }, (_, index) => ({
          name: index === 0 ? keyword : keyword + ' 分店 ' + index,
          cityname: '南京市', address: '雨花台区玉兰路 ' + index + ' 号',
          location: { getLng: () => 118.79687712345 + index / 1000, getLat: () => 31.96867898765 },
        })) } });
      };
      if (keyword === '旧查询') setTimeout(reply, 250);
      else reply();
    }
  };
})();
`;
