(function () {
  const ICONS = {
    sunny: '☀',
    'partly-cloudy': '⛅',
    cloudy: '☁',
    fog: '雾',
    rain: '☂',
    snow: '雪',
    storm: '雷',
    unknown: '气',
  };

  const byId = id => document.getElementById(id);
  let loading = false;

  function setState(text, detail, state = 'idle') {
    const button = byId('weather-button');
    const textNode = byId('weather-text');
    const detailNode = byId('weather-location');
    if (!button || !textNode || !detailNode) return;
    textNode.textContent = text;
    detailNode.textContent = detail;
    button.dataset.state = state;
    button.setAttribute('aria-label', `${text}。${detail}。点击重新定位`);
  }

  function errorText(error) {
    if (error?.code === 1) return ['未获得定位权限', '点击后允许定位，即可查看实时天气'];
    if (error?.code === 2) return ['暂时无法定位', '请开启设备定位服务后重试'];
    if (error?.code === 3) return ['定位超时', '请移到信号较好的位置后重试'];
    return ['天气暂不可用', '点击重新获取当前位置天气'];
  }

  async function loadAt(position) {
    const latitude = Number(position.coords.latitude);
    const longitude = Number(position.coords.longitude);
    const accuracy = Number(position.coords.accuracy);
    try {
      setState('正在读取实时天气…', '已定位，正在查询天气', 'loading');
      const data = await API.get(`/api/weather?latitude=${latitude.toFixed(5)}&longitude=${longitude.toFixed(5)}`);
      const icon = byId('weather-icon');
      if (icon) icon.textContent = ICONS[data.icon] || ICONS.unknown;
      const range = `${data.high}°/${data.low}°`;
      setState(`${data.condition} ${range} ${data.advice.text}`, `当前位置 · 定位精度约${Math.max(1, Math.round(accuracy))}米 · ${data.source}`, data.advice.level);
    } catch (error) {
      setState('天气服务暂不可用', error?.message || '请稍后重试', 'error');
    } finally {
      loading = false;
    }
  }

  function requestLocation() {
    if (loading) return;
    if (!navigator.geolocation) {
      setState('当前浏览器不支持定位', '请更换浏览器或手动查看当地天气', 'error');
      return;
    }
    loading = true;
    setState('正在定位…', '浏览器可能会询问是否允许定位', 'loading');
    navigator.geolocation.getCurrentPosition(loadAt, error => {
      const [title, detail] = errorText(error);
      setState(title, detail, 'error');
      loading = false;
    }, {
      enableHighAccuracy: false,
      timeout: 10000,
      maximumAge: 10 * 60 * 1000,
    });
  }

  async function init() {
    const button = byId('weather-button');
    if (!button) return;
    button.addEventListener('click', requestLocation);
    setState('获取当前位置天气', '点击定位；位置仅用于本次天气查询', 'idle');
    if (!navigator.permissions?.query) return;
    try {
      const permission = await navigator.permissions.query({ name: 'geolocation' });
      if (permission.state === 'granted') requestLocation();
      permission.addEventListener?.('change', () => {
        if (permission.state === 'granted') requestLocation();
      });
    } catch {}
  }

  window.WeatherWidget = { init, refresh: requestLocation };
})();
