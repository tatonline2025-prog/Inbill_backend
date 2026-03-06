const readEnv = (name: string): string => {
  const value = process.env[name];
  if (!value || !String(value).trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return String(value).trim();
};

export const getMongoUri = (): string => readEnv("MONGO_URI");
export const getJwtSecret = (): string => readEnv("JWT_SECRET");

