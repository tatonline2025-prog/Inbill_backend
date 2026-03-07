const readEnv = (name: string, fallback?: string): string => {
  const value = process.env[name];
  if (value && String(value).trim()) {
    return String(value).trim();
  }

  if (fallback && String(fallback).trim()) {
    console.warn(`[env] ${name} is missing. Using development fallback.`);
    return String(fallback).trim();
  }

  throw new Error(`Missing required environment variable: ${name}`);
};

export const getMongoUri = (): string => readEnv("MONGO_URI");
export const getJwtSecret = (): string =>
  readEnv("JWT_SECRET", process.env.NODE_ENV === "production" ? undefined : "dev-local-jwt-secret");
