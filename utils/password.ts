import bcrypt from 'bcrypt';

const hashPassword = async (funcPassword: string) =>{
    try {  
        const saltRounds = 10; 
        const hashedPassword = await bcrypt.hash(funcPassword, saltRounds);  
        return hashedPassword;  
    } catch (err: any) {  
        throw new Error('Error hashing password: ' + err.message);  
    }  
}

const verifyPassword = async (userPassword: string, hashedPassword: string) =>{  
    try {  
        const isMatch = await bcrypt.compare(userPassword, hashedPassword);  
        return isMatch;  
    } catch (err: any) {  
        throw new Error('Error verifying password: ' + err.message);  
    }  
}

export {hashPassword, verifyPassword};