import { ErrorRequestHandler, NextFunction, Request, Response } from "express";
import Clg from "../utils/clg";

export const errorHandler: ErrorRequestHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
    const content = req.error_handler || {};
    Clg.error(`${content.originalError}`, `${content.location}`);
    res.status(500).json({ error: 'Internal Server Error' });
}