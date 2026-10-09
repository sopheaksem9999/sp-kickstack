/** An error carrying the HTTP status the API error middleware should answer with. */
export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const badRequest = (message: string) => new HttpError(400, message);
export const conflict = (message: string) => new HttpError(409, message);
