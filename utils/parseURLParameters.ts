const parseURLParameters = (url: string): { [key: string]: string } | null => {
    const queryString = url.split('?')[1];
    if (!queryString) {
        return null;
    }

    const parameters: { [key: string]: string } = {};
    queryString.split('&').forEach(param => {
        const [key, value] = param.split('=');
        parameters[key] = decodeURIComponent(value || '');
    });

    return parameters;
}

export default parseURLParameters;