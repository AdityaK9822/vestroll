/* eslint-disable no-console */
import { db } from "../db";
import { employees } from "../db/schema";
import { eq } from "drizzle-orm";

export interface BankValidationResult {
  isValid: boolean;
  bankName?: string;
  bankAddress?: string;
  bankCity?: string;
  bankCountry?: string;
  accountType?: string;
  error?: string;
  confidence?: number;
}

export interface AccountVerificationResult {
  isValid: boolean;
  isVerified: boolean;
  bankDetails?: {
    bankName: string;
    bankAddress: string;
    bankCity: string;
    bankCountry: string;
    accountType: string;
  };
  error?: string;
}

class BankAccountService {
  // Mock bank validation API - in production, this would integrate with real banking APIs
  async validateBankAccount(accountData: {
    accountNumber: string;
    routingNumber?: string;
    sortCode?: string;
    iban?: string;
    swiftCode?: string;
    bankCountry: string;
  }): Promise<BankValidationResult> {
    try {
      // Simulate API call delay
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Mock validation logic based on country and account format
      const result: BankValidationResult = {
        isValid: false,
        confidence: 0,
      };

      // US account validation (routing + account)
      if (accountData.bankCountry === "US" && accountData.routingNumber && accountData.accountNumber) {
        const isValidRouting = this.validateUSRoutingNumber(accountData.routingNumber);
        const isValidAccount = this.validateUSAccountNumber(accountData.accountNumber);
        
        if (isValidRouting && isValidAccount) {
          result.isValid = true;
          result.confidence = 0.95;
          result.bankName = this.getBankNameFromRouting(accountData.routingNumber);
          result.bankAddress = "123 Banking Street";
          result.bankCity = "New York";
          result.bankCountry = "US";
          result.accountType = "checking";
        } else {
          result.error = "Invalid US routing or account number format";
        }
      }
      // UK account validation (sort code + account)
      else if (accountData.bankCountry === "GB" && accountData.sortCode && accountData.accountNumber) {
        const isValidSortCode = this.validateUKSortCode(accountData.sortCode);
        const isValidAccount = this.validateUKAccountNumber(accountData.accountNumber);
        
        if (isValidSortCode && isValidAccount) {
          result.isValid = true;
          result.confidence = 0.92;
          result.bankName = this.getBankNameFromSortCode(accountData.sortCode);
          result.bankAddress = "456 Financial Avenue";
          result.bankCity = "London";
          result.bankCountry = "GB";
          result.accountType = "current";
        } else {
          result.error = "Invalid UK sort code or account number format";
        }
      }
      // IBAN validation for European countries
      else if (accountData.iban && this.validateIBAN(accountData.iban)) {
        result.isValid = true;
        result.confidence = 0.90;
        result.bankName = this.getBankNameFromIBAN(accountData.iban);
        result.bankAddress = "789 Euro Boulevard";
        result.bankCity = "Frankfurt";
        result.bankCountry = accountData.iban.substring(0, 2);
        result.accountType = "current";
      } else {
        result.error = "Invalid account details for the specified country";
      }

      return result;
    } catch (error) {
      console.error("[Bank Validation Error]", error);
      return {
        isValid: false,
        error: "Bank validation service unavailable",
        confidence: 0,
      };
    }
  }

  // Update employee account details
  async updateEmployeeAccount(employeeId: string, accountData: any): Promise<void> {
    try {
      await db
        .update(employees)
        .set({
          ...accountData,
          updatedAt: new Date(),
        })
        .where(eq(employees.id, employeeId));
    } catch (error) {
      console.error("[Update Employee Account Error]", error);
      throw new Error("Failed to update employee account details");
    }
  }

  // Verify employee account
  async verifyEmployeeAccount(employeeId: string, accountNumber: string, bankName: string): Promise<AccountVerificationResult> {
    try {
      const employee = await db
        .select()
        .from(employees)
        .where(eq(employees.id, employeeId))
        .limit(1);

      if (!employee[0]) {
        return {
          isValid: false,
          isVerified: false,
          error: "Employee not found",
        };
      }

      const emp = employee[0];
      
      // Check if account details match
      if (emp.accountNumber !== accountNumber || emp.bankName !== bankName) {
        return {
          isValid: false,
          isVerified: false,
          error: "Account details do not match records",
        };
      }

      // Validate the account
      const validationResult = await this.validateBankAccount({
        accountNumber: emp.accountNumber!,
        routingNumber: emp.routingNumber || undefined,
        sortCode: emp.sortCode || undefined,
        iban: emp.iban || undefined,
        swiftCode: emp.swiftCode || undefined,
        bankCountry: emp.bankCountry || "US",
      });

      if (!validationResult.isValid) {
        return {
          isValid: false,
          isVerified: false,
          error: validationResult.error || "Bank validation failed",
        };
      }

      // Mark account as verified
      await db
        .update(employees)
        .set({
          isAccountVerified: true,
          accountVerifiedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(employees.id, employeeId));

      return {
        isValid: true,
        isVerified: true,
        bankDetails: {
          bankName: validationResult.bankName || emp.bankName!,
          bankAddress: validationResult.bankAddress || emp.bankAddress || "",
          bankCity: validationResult.bankCity || emp.bankCity || "",
          bankCountry: validationResult.bankCountry || emp.bankCountry || "",
          accountType: validationResult.accountType || emp.accountType || "checking",
        },
      };
    } catch (error) {
      console.error("[Verify Employee Account Error]", error);
      return {
        isValid: false,
        isVerified: false,
        error: "Account verification failed",
      };
    }
  }

  // Get employee account details
  async getEmployeeAccount(employeeId: string) {
    try {
      const employee = await db
        .select({
          id: employees.id,
          bankName: employees.bankName,
          accountNumber: employees.accountNumber,
          routingNumber: employees.routingNumber,
          sortCode: employees.sortCode,
          iban: employees.iban,
          swiftCode: employees.swiftCode,
          accountType: employees.accountType,
          accountHolderName: employees.accountHolderName,
          isAccountVerified: employees.isAccountVerified,
          accountVerifiedAt: employees.accountVerifiedAt,
          bankAddress: employees.bankAddress,
          bankCity: employees.bankCity,
          bankCountry: employees.bankCountry,
        })
        .from(employees)
        .where(eq(employees.id, employeeId))
        .limit(1);

      return employee[0] || null;
    } catch (error) {
      console.error("[Get Employee Account Error]", error);
      throw new Error("Failed to retrieve employee account details");
    }
  }

  // Validation helper methods
  private validateUSRoutingNumber(routingNumber: string): boolean {
    // US routing number validation (9 digits, Luhn algorithm)
    if (!/^\d{9}$/.test(routingNumber)) return false;
    
    const digits = routingNumber.split('').map(Number);
    const checksum = 
      3 * (digits[0] + digits[3] + digits[6]) +
      7 * (digits[1] + digits[4] + digits[7]) +
      (digits[2] + digits[5] + digits[8]);
    
    return checksum % 10 === 0;
  }

  private validateUSAccountNumber(accountNumber: string): boolean {
    // Basic US account number validation (8-17 digits)
    return /^\d{8,17}$/.test(accountNumber);
  }

  private validateUKSortCode(sortCode: string): boolean {
    // UK sort code validation (6 digits, format XX-XX-XX)
    return /^\d{6}$/.test(sortCode);
  }

  private validateUKAccountNumber(accountNumber: string): boolean {
    // Basic UK account number validation (8 digits)
    return /^\d{8}$/.test(accountNumber);
  }

  private validateIBAN(iban: string): boolean {
    // Basic IBAN validation
    const cleanIBAN = iban.replace(/\s/g, '').toUpperCase();
    if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(cleanIBAN)) return false;
    
    // Move first 4 characters to end and convert to numbers
    const rearranged = cleanIBAN.substring(4) + cleanIBAN.substring(0, 4);
    const numeric = rearranged.replace(/[A-Z]/g, char => (char.charCodeAt(0) - 55).toString());
    
    // Mod 97 check
    let remainder = numeric;
    while (remainder.length > 2) {
      const block = remainder.substring(0, 9);
      remainder = (parseInt(block, 10) % 97) + remainder.substring(9);
    }
    
    return parseInt(remainder, 10) % 97 === 1;
  }

  // Mock bank name lookup methods
  private getBankNameFromRouting(routingNumber: string): string {
    const routingBanks: Record<string, string> = {
      "021000021": "Bank of America",
      "111000025": "Bank of America",
      "026009593": "Bank of America",
      "121000248": "Wells Fargo",
      "124002971": "Wells Fargo",
      "321171184": "Wells Fargo",
      "011000028": "Bank of America",
      "021200339": "Citibank",
      "322271727": "Citibank",
    };
    return routingBanks[routingNumber] || "Unknown Bank";
  }

  private getBankNameFromSortCode(sortCode: string): string {
    const sortCodeBanks: Record<string, string> = {
      "040000": "National Westminster Bank",
      "090000": "National Westminster Bank",
      "200000": "Barclays Bank",
      "209000": "Barclays Bank",
      "400000": "HSBC Bank",
      "405000": "HSBC Bank",
      "600000": "Lloyds Bank",
      "770000": "Lloyds Bank",
    };
    return sortCodeBanks[sortCode] || "Unknown Bank";
  }

  private getBankNameFromIBAN(iban: string): string {
    const countryCode = iban.substring(0, 2);
    const countryBanks: Record<string, string> = {
      "DE": "Deutsche Bank",
      "FR": "BNP Paribas",
      "IT": "Intesa Sanpaolo",
      "ES": "Santander",
      "NL": "ING Bank",
      "BE": "KBC Bank",
      "AT": "Erste Bank",
    };
    return countryBanks[countryCode] || "Unknown Bank";
  }
}

export const bankAccountService = new BankAccountService();
