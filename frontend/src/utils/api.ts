export const getApiBaseUrl = (): string => {
  const fromEnv = process.env.REACT_APP_API_URL;
  if (fromEnv) {
    return fromEnv;
  }

  if (process.env.NODE_ENV === 'development') {
    return '';
  }

  return window.location.origin;
};
