import * as crypto from 'crypto';

// 定义加密算法和密钥
const ALGORITHM = 'aes-256-gcm';
const KEY = crypto.randomBytes(32); // 生成一个随机密钥
const IV_LENGTH = 16; // 初始化向量长度

/**
 * 使用对称加密算法加密给定的文本
 * 
 * 此函数采用指定的加密算法和密钥对输入的文本进行加密它生成一个随机的初始化向量（IV），
 * 并使用该向量和密钥创建一个加密器加密后的数据、初始化向量和认证标签被封装在一个对象中返回
 * 
 * @param text 需要加密的原始文本
 * @returns 返回一个包含初始化向量（iv）、加密数据（encryptedData）和认证标签（tag）的对象
 */
function encrypt(text: string): { iv: string; encryptedData: string; tag: string } {
    const iv = crypto.randomBytes(IV_LENGTH); // 生成随机初始化向量
    const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const tag = cipher.getAuthTag(); // 获取认证标签
    return {
        iv: iv.toString('hex'),
        encryptedData: encrypted,
        tag: tag.toString('hex')
    };
}

/**
 * 解密函数，用于解密给定的加密数据
 * @param encryptedData 包含加密数据的对象，包括iv（初始化向量）、encryptedData（加密数据）和tag（认证标签）
 * @returns 解密后的字符串
 */
function decrypt(encryptedData: { iv: string; encryptedData: string; tag: string }): string {
    const iv = Buffer.from(encryptedData.iv, 'hex');
    const encryptedText = Buffer.from(encryptedData.encryptedData, 'hex');
    const tag = Buffer.from(encryptedData.tag, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
    decipher.setAuthTag(tag); // 设置认证标签
    let decrypted = decipher.update(encryptedText).toString('utf8'); // 直接使用 Buffer 类型作为输入
    decrypted += decipher.final('utf8');
    const cleanedString = decrypted.trim();
    return cleanedString;
}

export { encrypt, decrypt };