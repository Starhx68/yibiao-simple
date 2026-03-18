export const getApiBaseUrl = (): string => {
  const fromEnv = process.env.REACT_APP_API_URL;
  if (fromEnv) {
    return fromEnv;
  }

  const hostname = window.location.hostname || '127.0.0.1';

  if (process.env.NODE_ENV === 'development') {
    return `http://${hostname}:18000`;
  }

  return window.location.origin;
};
