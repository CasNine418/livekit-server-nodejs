export interface BasicAppHttpResponseBody<T, M> {
    /**
     * @description 响应的body的描述
     * @type {string}
     * @memberof BasicAppHttpRequestBody
     */
    message?: string;

    /**
     * @description 请求的数据
     * @type {T}
     * @memberof BasicAppHttpRequestBody
     */
    data?: T;

    /**
     * @description 请求的元数据
     * @type {M}
     * @memberof BasicAppHttpRequestBody
     */
    metadata?: M;
}

export function buildErrorResponse<T, M>(message: string, data: T, metadata: M): BasicAppHttpResponseBody<T, M> {
    return {
        message: message,
        data: data,
        metadata: metadata
    };
}

export function buildResponse<T, M>(message: string, data: T, metadata: M): BasicAppHttpResponseBody<T, M> {
    return {
        message: message,
        data: data,
        metadata: metadata
    }
}